import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// The left drawer's file list, in the running app.
//
// One list now, not two: everything opened recently, with the ones still open
// marked. Two sections meant a file you had open appeared twice, and the same
// click did different things depending on which copy you hit.
//
// The cross undoes whatever the row most recently became — it closes an open
// file, and forgets a closed one. That is asserted here because it is the part
// of the merge a reader would most reasonably expect to work the other way.
//
// Persistence across a restart is asserted in the unit suite, against the store
// itself: a renderer reload would not show it, since the main process arms its
// bootstrap handshake with `once` and does not re-send it.

const list = (page: Page) => page.locator('.side-bar .file-list')
const rows = (page: Page) => list(page).locator('.file-row')
const names = (page: Page) => rows(page).locator('.name')

test.describe('the file list in the left drawer', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Opened document\n')
    app = launched.app
    page = launched.page
    await page.waitForFunction(() => {
      const el = document.querySelector('.side-bar') as HTMLElement | null
      return !!(el && el.offsetParent !== null && el.getBoundingClientRect().width > 220)
    }, null, { timeout: 5000 })
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('lists the document that was opened', async() => {
    await expect(list(page)).toBeVisible()
    await expect(names(page)).toHaveText(['note.md'])
  })

  test('marks it as open', async() => {
    // The mark is what replaced the separate "opened files" section.
    await expect(rows(page).first()).toHaveClass(/\bopen\b/)
  })

  test('closing from the list leaves the file in it, unmarked', async() => {
    const row = rows(page).first()
    await row.hover()
    await row.locator('.action-icon').click()

    // Still listed — it is still a file you have worked with — but no longer
    // open, so the cross now means "forget" rather than "close".
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).not.toHaveClass(/\bopen\b/)
  })

  test('forgets an entry only when its own control is used', async() => {
    const row = rows(page).first()
    await row.hover()
    await row.locator('.action-icon').click()

    await expect(rows(page)).toHaveCount(0)
    // The section goes with its last row rather than sitting there empty.
    await expect(list(page)).toHaveCount(0)
  })
})
