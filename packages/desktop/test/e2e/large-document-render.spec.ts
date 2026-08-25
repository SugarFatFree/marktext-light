// The performance requirements, measured in a real window: start fast, stay
// small, open a large document, and keep taking keystrokes afterwards.
//
// They share one file, and one launched app, on purpose. Playwright runs with
// two workers, so two specs each opening 210 KB and timing it were measuring
// each other's CPU contention as much as their own work. Within a file the
// cases run in order, in one worker.
//
// Opening a large document in a real window.
//
// The parser was quadratic in three separate places and is now linear, but that
// was measured in unit tests, on the parse alone. What a user waits for is the
// parse *plus* building the block tree and rendering it, and none of that had
// ever been timed — there is no WebView on the development machine, so this
// runner is the only place it can be.
//
// The budget is deliberately loose. It is not a performance target; it is a
// tripwire for the failure mode that already happened once, where a document
// this size took minutes instead of seconds. The measured time is printed so
// the real number is visible in the log even when the test passes.

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, sendIpcToRenderer } from './helpers'

interface Timings {
  domContentLoaded: number
  loadEnd: number
  editorReady: number
}

interface CallFrame {
  functionName: string
  url: string
  lineNumber: number
}
interface ProfileNode {
  id: number
  callFrame: CallFrame
  hitCount?: number
}

// 200, down from 300 — and 300 down from the 1200 first tried. At ~850 KB the renderer stayed saturated past
// a 105s timeout — `page.evaluate` could not even get a turn to count, and
// closing the window timed out too. That limit is recorded in
// docs/PARITY_PLAN.md rather than papered over; this size is a guard that can
// actually run, not a statement that 128 KB is what "large" means.
//
// It came down again after this file's own weight started costing other specs
// their timing: with two workers, an unrelated save round-trip missed a 5s
// poll while this one was opening a document and profiling beside it. A
// measurement that makes the rest of the suite flaky is not worth its
// precision.
const SECTIONS = 200
// A ceiling, not a target: the real number is printed below, and this can be
// tightened once a few runs have shown what it actually is on this runner.
//
// It must stay under the per-test timeout, which the spec raises for itself —
// the first version set a 40s budget against playwright.config.ts's 30s and
// measured nothing at all, because the harness killed the test first.
const BUDGET_MS = 45000

/** ~128 KB of ordinary prose: headings, paragraphs, a list, some inline marks.
 *  Deliberately not pathological — the point is that a normal big document is
 *  fine, not that a crafted one is. */
const buildDocument = (sections: number): string => {
  const parts: string[] = ['# Large document\n']
  for (let i = 0; i < sections; i++) {
    parts.push(
      `## Section ${i}\n`,
      `Paragraph with **bold**, *italic* and \`code\` in section ${i}. `.repeat(10),
      '\n\n',
      `- first item of ${i}\n- second item of ${i}\n- third item of ${i}\n\n`,
      `> A quoted line in section ${i}.\n\n`
    )
  }
  return parts.join('')
}

/**
 * Live JS heap in MB, after a forced collection.
 *
 * Through CDP rather than `performance.memory`, which is bucketed to resist
 * fingerprinting and reported 17 MB both before and after loading 139 KB of
 * markdown — a number precise enough to be quoted and too coarse to mean
 * anything. Collecting first makes the reading about what is retained rather
 * than what has not been swept yet.
 */
const heapMb = async(page: Page): Promise<number | null> => {
  const client = await page.context().newCDPSession(page)
  try {
    await client.send('HeapProfiler.enable')
    await client.send('HeapProfiler.collectGarbage')
    const usage = (await client.send('Runtime.getHeapUsage')) as { usedSize: number }
    return Math.round((usage.usedSize / (1024 * 1024)) * 10) / 10
  } catch {
    return null
  } finally {
    await client.detach()
  }
}

test.describe('a large document', () => {
  let app: ElectronApplication
  let page: Page
  let blankHeapMb: number | null = null

  test.beforeAll(async() => {
    // Start small: this measures the document, not Electron's startup.
    const launched = await launchWithMarkdown('# Small\n')
    app = launched.app
    page = launched.page
    blankHeapMb = await heapMb(page)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  // Two requirements that had been argued from bundle sizes rather than
  // measured: start fast, and stay small. What is measured is the RENDERER's
  // share — navigation timing inside the page — not the whole launch:
  // `launchElectron` sleeps half a second of its own, and process spawn belongs
  // to Electron, which is not what this build ships. The renderer half is what
  // the bundle work targeted and what carries over to Tauri unchanged.
  test('reaches a usable editor within the renderer timeline', async() => {
    const timings = await page.evaluate<Timings>(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      return {
        domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0),
        loadEnd: Math.round(nav?.loadEventEnd ?? 0),
        editorReady: Math.round(performance.now())
      }
    })

    console.log(
      `renderer: DOMContentLoaded ${timings.domContentLoaded} ms, ` +
        `load ${timings.loadEnd} ms, editor usable by ${timings.editorReady} ms`
    )

    // Read after the editor is already up, so it is an upper bound that
    // includes this call's own latency — the honest direction for a ceiling.
    expect(timings.editorReady, 'the renderer took longer than any launch should')
      .toBeLessThan(30_000)
    expect(timings.domContentLoaded, 'no navigation timing was recorded').toBeGreaterThan(0)
  })

  test('opens and renders without falling off a cliff', async() => {
    test.setTimeout(BUDGET_MS + 60_000)

    const markdown = buildDocument(SECTIONS)
    expect(markdown.length).toBeGreaterThan(120_000)

    const started = Date.now()
    await sendIpcToRenderer(
      app,
      'mt::open-new-tab',
      { markdown, filename: 'large.md', pathname: '/tmp/marktext-e2e-large.md' },
      {},
      true
    )

    // Every section is a heading, so the count says how much of the document
    // reached the DOM — muya renders all of it, with no windowing.
    const headings = (): Promise<number> =>
      page.evaluate(() => document.querySelectorAll('.editor-component h2').length)

    // Polled rather than waited on, so a document that renders too slowly can
    // be told apart from a tab that never opened. The first says the editor is
    // slow; the second says the test is wired up wrong, and they want
    // different fixes.
    let count = 0
    while (Date.now() - started < BUDGET_MS) {
      count = await headings()
      if (count >= SECTIONS) break
      await page.waitForTimeout(500)
    }
    const elapsed = Date.now() - started

    console.log(
      `large document: ${Math.round(markdown.length / 1024)} KB, ` +
        `${count}/${SECTIONS} sections in ${elapsed} ms`
    )

    expect(count, 'the tab never opened at all').toBeGreaterThan(0)
    expect(
      count,
      `only ${count} of ${SECTIONS} sections rendered in ${elapsed} ms`
    ).toBeGreaterThanOrEqual(SECTIONS)
  })

  test('is still editable once it is open', async() => {
    // Rendering it is not the whole story: the earlier quadratic behaviour also
    // made every subsequent keystroke slow, which a render-time check misses.
    //
    // Assert the document is actually here first. This runs after the case
    // above whether that one passed or not, and a typing time measured against
    // a document that never opened says nothing.
    const rendered = await page.evaluate(
      () => document.querySelectorAll('.editor-component h2').length
    )
    expect(rendered, 'no large document to type into').toBeGreaterThanOrEqual(SECTIONS)

    await page.click('.editor-component')
    const started = Date.now()
    await page.keyboard.type('typed')
    const elapsed = Date.now() - started

    console.log(`five keystrokes in a large document: ${elapsed} ms`)
    expect(elapsed).toBeLessThan(5000)
  })

  test('holds the document without the heap running away', async() => {
    test.skip(blankHeapMb === null, 'this build exposes no heap statistics')
    const loaded = await heapMb(page)

    console.log(`heap after GC: ${blankHeapMb} MB blank, ${loaded} MB holding the document`)

    // Measured once the reading became trustworthy: 11 MB blank, 15.3 MB
    // holding 139 KB — about 4.3 MB for the document, some thirty times the
    // source text, which is what a block tree plus a JSON copy of the content
    // costs. The ceiling leaves an order of magnitude over that: loose enough
    // to ignore runner variance, tight enough that a leak or a second retained
    // copy would trip it.
    expect(loaded, 'the heap grew out of proportion to the document').toBeLessThan(
      (blankHeapMb ?? 0) + 60
    )
  })

  // A probe, not a guard: it asserts only that the profiler attached, and
  // prints where the time went. It lives in this file so it runs after the
  // cases above rather than beside them — with two Playwright workers, two
  // specs each opening 210 KB and timing it were measuring each other's CPU
  // contention as much as their own work.
  test('reports where a keystroke spends its time', async() => {
    test.setTimeout(120_000)

    const rendered = await page.evaluate(
      () => document.querySelectorAll('.editor-component h2').length
    )
    expect(rendered, 'no large document to profile').toBeGreaterThanOrEqual(SECTIONS)

    const client = await page.context().newCDPSession(page)
    await client.send('Profiler.enable')
    // 100 microseconds: fine enough to separate callees that each take a
    // millisecond or two out of a keystroke.
    await client.send('Profiler.setSamplingInterval', { interval: 100 })
    await client.send('Profiler.start')

    const started = Date.now()
    await page.keyboard.type('abcde', { delay: 0 })
    const elapsed = Date.now() - started

    const { profile } = (await client.send('Profiler.stop')) as {
      profile: { nodes: ProfileNode[] }
    }
    await client.detach()

    const self = new Map<string, number>()
    for (const node of profile.nodes) {
      const { functionName, url, lineNumber } = node.callFrame
      const where = `${functionName || '(anonymous)'}  ${String(url).split('/').slice(-1)[0]}:${lineNumber + 1}`
      self.set(where, (self.get(where) ?? 0) + (node.hitCount ?? 0))
    }
    const total = [...self.values()].reduce((a, b) => a + b, 0)

    console.log(`five keystrokes while profiling: ${elapsed} ms, ${total} samples`)
    for (const [where, hits] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`  ${((hits / total) * 100).toFixed(1)}%  ${where}`)
    }

    // A profile that failed to attach would print an empty ranking, which reads
    // like a finding.
    expect(total, 'the profiler collected no samples').toBeGreaterThan(0)
  })
})
