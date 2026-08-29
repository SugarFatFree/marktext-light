// The startup trace, read out of a window that actually started.
//
// The phase marks exist to answer where the seconds between double-clicking the
// icon and seeing text go. Under Tauri the shell writes its own half to a file;
// this covers the renderer's half, which is the same code in both shells — only
// the bootstrap differs, and that lands after the marks compared here.
//
// What this asserts is that the instrument still works: every phase present,
// once, in order. Not the durations — a shared CI runner cannot say anything
// trustworthy about 40 ms, and a threshold that flaps would get muted, which is
// how you end up with an instrument nobody reads. The numbers are logged for
// whoever is reading the run.
//
// The marks have already misled twice by being named for a cause rather than a
// position — `engine constructed` sat before the engine was built, and
// `commands ready` sat downstream of work it did not measure. Losing one
// silently would be worse, hence the order check.

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

/** In the order `main.ts`, `app.vue`, the command store and `editor.vue` mark
 *  them. `document fetched` / `bundle fetched` come from the timing API and are
 *  absent when the page was not fetched over a URL the API records. */
const PHASES = [
  'script start',
  'shell bridge',
  'mounted',
  'shell flushed',
  'microtasks drained',
  'commands sorted',
  'commands ready',
  'bootstrap dispatched',
  'listeners registered',
  'editor mounting',
  'engine about to build',
  'engine constructed',
  'editor ready'
]

/** Nothing unordered at present. `shell flushed` was, while it came from a
 *  `nextTick` whose position depended on the very thing it measured; queued as
 *  a plain microtask it now sits between `mounted` and `microtasks drained` by
 *  construction, so the order check can hold it there. */
const UNORDERED: string[] = []

/** Nothing is optional at present. `shell updated` lived here until it turned
 *  out never to fire under Tauri at all: an `onUpdated` hook runs after the
 *  children it mounts, by which time `editor ready` has closed the trace. */
const OPTIONAL: string[] = []

interface Phase {
  /** Without the measurement, for matching against the lists above. */
  name: string
  /** As written in the trace, measurement and all, for reading. */
  marked: string
  at: number
}

/** Some phases carry a measurement in their name — the bundle's size, the
 *  document's — so that two traces can be compared rather than just read. The
 *  phase is the part in front of it. */
const phaseName = (marked: string): string => marked.replace(/ \(.*\)$/, '')

const parse = (line: string): Phase[] =>
  line.split(' · ').map((entry) => {
    const match = /^(.*) (\d+)ms$/.exec(entry)
    expect(match, `unreadable phase entry: ${entry}`).not.toBeNull()

    const marked = match![1] as string

    return { name: phaseName(marked), marked, at: Number(match![2]) }
  })

test.describe('startup phases', () => {
  let app: ElectronApplication
  let page: Page
  let phases: Phase[]

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Doc\n\nSome text.\n')
    app = launched.app
    page = launched.page

    // `reportStartup` runs when the editor is ready, which is after the editor
    // is on screen — so waiting for the value is waiting for startup to finish.
    await page.waitForFunction(
      () => typeof (window as unknown as { __MT_STARTUP__?: string }).__MT_STARTUP__ === 'string',
      null,
      { timeout: 30000 }
    )
    const line = await page.evaluate(
      () => (window as unknown as { __MT_STARTUP__: string }).__MT_STARTUP__
    )
    phases = parse(line)

    const width = Math.max(...phases.map((p) => p.marked.length))
    const lines = phases.map((phase, i) => {
      const since = i === 0 ? phase.at : phase.at - phases[i - 1]!.at
      return `  ${phase.marked.padEnd(width)}  ${String(phase.at).padStart(5)} ms  (+${since})`
    })
    console.log(`startup phases:\n${lines.join('\n')}`)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('reports every phase exactly once', () => {
    const seen = phases.map((p) => p.name)

    for (const phase of [...PHASES, ...UNORDERED]) {
      expect(seen.filter((name) => name === phase), `phase "${phase}"`).toHaveLength(1)
    }

    for (const phase of OPTIONAL) {
      expect(seen.filter((name) => name === phase).length, `phase "${phase}"`)
        .toBeLessThanOrEqual(1)
    }
  })

  test('reports them in the order the code marks them', () => {
    // Marks carry a timestamp each, so a reordering shows up twice: in the
    // sequence and in the clock. Check the sequence — it is the one that says a
    // mark moved rather than that the machine was busy.
    const ordered = phases.filter((p) => PHASES.includes(p.name)).map((p) => p.name)

    expect(ordered).toEqual(PHASES)
  })

  test('never goes backwards in time', () => {
    const backwards = phases
      .slice(1)
      .map((phase, i) => ({ phase, previous: phases[i]! }))
      .filter(({ phase, previous }) => phase.at < previous.at)
      .map(({ phase, previous }) => `${previous.name} (${previous.at}) -> ${phase.name} (${phase.at})`)

    expect(backwards, 'a phase is marked before the one it follows').toEqual([])
  })
})
