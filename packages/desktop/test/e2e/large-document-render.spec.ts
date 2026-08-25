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

const SECTIONS = 1200
// A ceiling, not a target: the real number is printed below, and this can be
// tightened once a few runs have shown what it actually is on this runner.
const BUDGET_MS = 40000

/** ~850 KB of ordinary prose: headings, paragraphs, a list, some inline marks.
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

test.describe('a large document', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    // Start small: this measures the document, not Electron's startup.
    const launched = await launchWithMarkdown('# Small\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('opens and renders without falling off a cliff', async() => {
    const markdown = buildDocument(SECTIONS)
    expect(markdown.length).toBeGreaterThan(800_000)

    const started = Date.now()
    await sendIpcToRenderer(
      app,
      'mt::open-new-tab',
      { markdown, filename: 'large.md', pathname: '/tmp/marktext-e2e-large.md' },
      {},
      true
    )

    // Every section is a heading, so the count says the whole document made it
    // into the DOM rather than just the first screen of it.
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.editor-component h2').length >= expected,
      SECTIONS,
      { timeout: BUDGET_MS }
    )
    const elapsed = Date.now() - started

    console.log(`large document: ${Math.round(markdown.length / 1024)} KB rendered in ${elapsed} ms`)
    expect(elapsed).toBeLessThan(BUDGET_MS)
  })

  test('is still editable once it is open', async() => {
    // Rendering it is not the whole story: the earlier quadratic behaviour also
    // made every subsequent keystroke slow, which a render-time check misses.
    await page.click('.editor-component')
    const started = Date.now()
    await page.keyboard.type('typed')
    const elapsed = Date.now() - started

    console.log(`five keystrokes in a large document: ${elapsed} ms`)
    expect(elapsed).toBeLessThan(5000)
  })
})
