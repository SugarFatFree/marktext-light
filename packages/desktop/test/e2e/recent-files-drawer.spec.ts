import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown } from './helpers'

// The left drawer's recent-files list, in the running app.
//
// Persistence across a restart is asserted in the unit suite, against the store
// itself — a renderer reload here would not show it anyway, since the main
// process arms its bootstrap handshake with `once` and does not re-send it.
// What only this level can show is that opening a document actually puts it in
// the drawer, and that the remove control is what takes it out again.

const recentSection = (page: Page) => page.locator('.side-bar .recent-files')
const recentEntries = (page: Page) => recentSection(page).locator('.recent-file .name')

test.describe('recent files in the left drawer', () => {
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
    await expect(recentSection(page)).toBeVisible()
    await expect(recentEntries(page)).toHaveText(['note.md'])
  })

  test('forgets an entry only when its remove control is used', async() => {
    const entry = recentSection(page).locator('.recent-file').first()
    await entry.hover()
    await entry.locator('.remove-icon').click()

    // The section goes with its last entry rather than sitting there empty.
    await expect(recentSection(page)).toHaveCount(0)
  })
})
