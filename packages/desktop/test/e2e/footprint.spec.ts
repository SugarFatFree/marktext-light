// What the running app actually occupies, per process.
//
// "Low footprint" has been argued from installer sizes and from the engine's
// JS heap. Neither is what a user sees in a task manager: the installer says
// nothing about runtime, and the heap is one number inside one of several
// processes. This reports the working set of every process Electron runs, so
// the Tauri build has something to be compared against rather than an
// impression.
//
// The numbers are the point; the assertions only guard against the reading
// becoming meaningless (no processes, zero sizes) or running away entirely.
// A tight ceiling on a shared runner would flap and then get muted.

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

interface ProcessMetric {
  type: string
  memory: { workingSetSize: number, peakWorkingSetSize: number }
}

/** Generous enough to ignore runner variance, tight enough that a process
 *  leaking its way to a gigabyte would not pass. */
const CEILING_MB = 2000

const mb = (kb: number): number => Math.round(kb / 1024)

test.describe('runtime footprint', () => {
  let app: ElectronApplication
  let page: Page
  let metrics: ProcessMetric[]

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Doc\n\nSome text.\n')
    app = launched.app
    page = launched.page

    // Electron reports the working set in KB, per process it owns — browser,
    // renderer, GPU and any utility processes.
    metrics = (await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics()
    )) as unknown as ProcessMetric[]

    const heapMb = await page.evaluate(() => {
      const perf = performance as unknown as { memory?: { usedJSHeapSize: number } }
      return perf.memory ? Math.round(perf.memory.usedJSHeapSize / 1048576) : null
    })

    const rows = metrics
      .slice()
      .sort((a, b) => b.memory.workingSetSize - a.memory.workingSetSize)
      .map((m) => `  ${m.type.padEnd(10)} ${String(mb(m.memory.workingSetSize)).padStart(5)} MB` +
        ` (peak ${mb(m.memory.peakWorkingSetSize)} MB)`)
    const total = metrics.reduce((n, m) => n + m.memory.workingSetSize, 0)

    console.log(
      `footprint with a small document:\n${rows.join('\n')}\n` +
      `  ${'total'.padEnd(10)} ${String(mb(total)).padStart(5)} MB` +
      `${heapMb === null ? '' : `\n  renderer JS heap: ${heapMb} MB`}`
    )
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('reports a working set for every process', () => {
    expect(metrics.length, 'no processes reported').toBeGreaterThan(0)

    const empty = metrics.filter((m) => m.memory.workingSetSize <= 0)
    expect(empty.map((m) => m.type), 'a process reported no memory at all').toEqual([])
  })

  test('reports the main process and at least one more', () => {
    // If the report shrinks to a single process the numbers above have stopped
    // describing the app that was launched. Only 'Browser' is asserted by name
    // — what Electron calls a renderer has changed between versions, and a
    // spec that fails on a label rather than on the app is worse than useless.
    const types = metrics.map((m) => m.type)

    expect(types).toContain('Browser')
    expect(types.filter((type) => type !== 'Browser').length,
      `only a main process was reported: ${types.join(', ')}`).toBeGreaterThan(0)
  })

  test('stays well under a runaway ceiling', () => {
    const total = mb(metrics.reduce((n, m) => n + m.memory.workingSetSize, 0))

    expect(total, `total working set ${total} MB`).toBeLessThan(CEILING_MB)
  })
})
