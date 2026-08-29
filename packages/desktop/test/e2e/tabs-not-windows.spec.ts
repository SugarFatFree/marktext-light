// Opening more files must add tabs, never windows.
//
// The bridge's routing for this is unit tested, but the property the
// requirement actually states is about the running application: after opening
// several documents there is still one window, and one tab each. Only a real
// app can be asked how many windows it has.
//
// The last case covers the dedupe the Quick Open fix leans on: its candidates
// are mostly already-open tabs, and picking one has to raise that tab rather
// than open a second copy of it.

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, sendIpcToRenderer } from './helpers'

const tabCount = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('.tabs-container li').length)

const openDocument = async(
  app: ElectronApplication,
  page: Page,
  filename: string,
  pathname: string
): Promise<void> => {
  await sendIpcToRenderer(
    app,
    'mt::open-new-tab',
    { markdown: `# ${filename}\n`, filename, pathname },
    {},
    true
  )
  // The tab lands through the store, so wait for the DOM rather than a timer.
  await page.waitForFunction(
    (title) => !!document.querySelector(`.tabs-container li[title="${title}"]`),
    pathname,
    { timeout: 10_000 }
  )
}

test.describe('opening several documents', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# First\n')
    app = launched.app
    page = launched.page
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('adds a tab per document and never a second window', async() => {
    expect(await tabCount(page), 'the launched document should be one tab').toBe(1)
    expect(app.windows()).toHaveLength(1)

    await openDocument(app, page, 'second.md', '/tmp/marktext-e2e-second.md')
    expect(await tabCount(page)).toBe(2)
    expect(app.windows(), 'a second document opened a second window').toHaveLength(1)

    await openDocument(app, page, 'third.md', '/tmp/marktext-e2e-third.md')
    expect(await tabCount(page)).toBe(3)
    expect(app.windows(), 'a third document opened another window').toHaveLength(1)
  })

  test('raises the existing tab when the same file is opened again', async() => {
    const before = await tabCount(page)

    await sendIpcToRenderer(
      app,
      'mt::open-new-tab',
      {
        markdown: '# second.md\n',
        filename: 'second.md',
        pathname: '/tmp/marktext-e2e-second.md'
      },
      {},
      true
    )

    // Give a duplicate tab a chance to appear before concluding it did not.
    await page.waitForTimeout(500)
    expect(await tabCount(page), 'the same path opened twice').toBe(before)

    const active = await page.evaluate(
      () => document.querySelector('.tabs-container li.active')?.getAttribute('title') ?? null
    )
    expect(active, 'reopening a file should raise its tab').toBe('/tmp/marktext-e2e-second.md')
  })
})
