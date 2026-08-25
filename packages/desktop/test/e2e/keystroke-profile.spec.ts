// A CPU profile of typing in a large document, taken in the real renderer.
//
// This is a probe, not a guard: it asserts almost nothing and prints where the
// time goes. It exists because the same measurement taken locally in happy-dom
// was misleading — 89% of those samples were happy-dom's own Range comparison,
// which it implements by walking siblings while a browser does it natively. The
// numbers looked right and meant nothing.
//
// Chromium is reachable here through CDP, so this is the one place the question
// can actually be answered.

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, sendIpcToRenderer } from './helpers'

const SECTIONS = 300

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

test.describe('typing in a large document', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Small\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('spends its time where the profile says', async() => {
    test.setTimeout(180_000)

    const markdown = buildDocument(SECTIONS)
    await sendIpcToRenderer(
      app,
      'mt::open-new-tab',
      { markdown, filename: 'large.md', pathname: '/tmp/marktext-e2e-profile.md' },
      {},
      true
    )
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.editor-component h2').length >= expected,
      SECTIONS,
      { timeout: 60_000 }
    )
    await page.click('.editor-component')

    const client = await page.context().newCDPSession(page)
    await client.send('Profiler.enable')
    // 100 microseconds: fine enough to separate callees that each take a
    // millisecond or two out of a ~100 ms keystroke.
    await client.send('Profiler.setSamplingInterval', { interval: 100 })
    await client.send('Profiler.start')

    const started = Date.now()
    await page.keyboard.type('abcdefghij', { delay: 0 })
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

    console.log(`ten keystrokes in ${Math.round(markdown.length / 1024)} KB: ${elapsed} ms`)
    console.log(`profile: ${total} samples`)
    for (const [where, hits] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
      console.log(`  ${((hits / total) * 100).toFixed(1)}%  ${where}`)
    }

    // The only thing worth failing on: a profile with nothing in it would mean
    // the probe never attached, and the output above would be a lie of omission.
    expect(total, 'the profiler collected no samples').toBeGreaterThan(0)
  })
})
