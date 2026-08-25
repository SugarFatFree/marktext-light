// Dark mode, measured in the running window rather than read off the source.
//
// The defect this catches is a colour that was written for the light theme and
// left behind: the surface turns dark, the text stays dark with it, and the
// element becomes unreadable. Source review finds the hardcoded literals but
// cannot tell which ones the cascade actually lands on — only a real window
// with the real stylesheet can, and the E2E runner has one.
//
// This is not a substitute for looking at it. Contrast says text can be read,
// not that the result looks right.

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, sendIpcToRenderer } from './helpers'

/** WCAG AA for body text is 4.5:1. Start at 3:1 — enough to catch a surface
 *  whose text was never restyled, without failing on decorative greys. */
const MIN_CONTRAST = 3

const SURFACES = [
  '.editor-component',
  '.side-bar',
  '.editor-tabs',
  '.title-bar'
]

interface Measurement {
  selector: string
  contrast: number
  backgroundLuminance: number
  color: string
  background: string
}

/** Measure text-vs-surface contrast in the page, where the cascade is real. */
const measure = (page: Page, selectors: string[]): Promise<Measurement[]> =>
  page.evaluate((list) => {
    const channel = (value: number): number => {
      const c = value / 255
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }

    const parse = (value: string): [number, number, number, number] | null => {
      const parts = value.match(/[\d.]+/g)
      if (!parts || parts.length < 3) return null
      const n = parts.map(Number)
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1]
    }

    const luminance = ([r, g, b]: [number, number, number, number]): number =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

    // The nearest ancestor that actually paints. A mostly-transparent layer is
    // skipped rather than blended: what the eye reads through it is whatever is
    // behind, and that is the comparison worth making.
    const surfaceOf = (el: Element): [number, number, number, number] => {
      let node: Element | null = el
      while (node) {
        const parsed = parse(getComputedStyle(node).backgroundColor)
        if (parsed && parsed[3] >= 0.9) return parsed
        node = node.parentElement
      }
      return [255, 255, 255, 1]
    }

    const results = []
    for (const selector of list) {
      const el = document.querySelector(selector)
      if (!el) continue
      const box = el.getBoundingClientRect()
      if (box.width < 8 || box.height < 8) continue

      const style = getComputedStyle(el)
      const text = parse(style.color)
      if (!text) continue
      const background = surfaceOf(el)

      const a = luminance(text)
      const b = luminance(background)
      const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

      results.push({
        selector,
        contrast: Math.round(contrast * 100) / 100,
        backgroundLuminance: Math.round(b * 1000) / 1000,
        color: style.color,
        background: `rgb(${background[0]}, ${background[1]}, ${background[2]})`
      })
    }
    return results
  }, selectors)

test.describe('the dark theme, in a real window', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async() => {
    const launched = await launchWithMarkdown('# Heading\n\nSome body text.\n')
    app = launched.app
    page = launched.page

    await sendIpcToRenderer(app, 'mt::user-preference', { theme: 'dark' })

    // The stylesheet is fetched on demand and lands a frame or two after the
    // preference does, so wait for the paint rather than for the event.
    await page.waitForFunction(() => {
      const el = document.querySelector('.editor-component')
      if (!el) return false
      const parts = getComputedStyle(el).backgroundColor.match(/\d+/g)
      if (!parts || parts.length < 3) return false
      const n = parts.map(Number)
      return ((n[0] ?? 255) + (n[1] ?? 255) + (n[2] ?? 255)) / 3 < 128
    }, null, { timeout: 10000 })
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('turns the surfaces dark, not just the editor', async() => {
    const measured = await measure(page, SURFACES)
    expect(measured.length, 'no surface was visible enough to measure').toBeGreaterThanOrEqual(2)

    for (const surface of measured) {
      expect(
        surface.backgroundLuminance,
        `${surface.selector} stayed light (${surface.background})`
      ).toBeLessThan(0.25)
    }
  })

  test('keeps text readable against them', async() => {
    const measured = await measure(page, SURFACES)

    for (const surface of measured) {
      expect(
        surface.contrast,
        `${surface.selector}: ${surface.color} on ${surface.background}`
      ).toBeGreaterThanOrEqual(MIN_CONTRAST)
    }
  })
})
