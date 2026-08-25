// Dark mode, measured in the running window rather than read off the source.
//
// The defect this catches is a colour that was written for the light theme and
// left behind: the surface turns dark, the text stays dark with it, and the
// element becomes unreadable. Source review finds the hardcoded literals but
// cannot tell which ones the cascade actually lands on — only a real window
// with the real stylesheet can, and the E2E runner has one.
//
// What makes the check cheap is that every themed text colour carries an alpha
// (`--editorColor` is rgba(255,255,255,0.7) in the dark theme, and the dimmed
// variants go down from there). So *opaque* text is, by construction, text no
// theme chose — a literal someone typed. That is the rule below, and also its
// limit: a hardcoded `rgba(0,0,0,0.7)` would pass, and contrast says text can
// be read, not that the result looks right.

import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { launchWithMarkdown, sendIpcToRenderer } from './helpers'

/** WCAG AA for body text is 4.5:1. Three is enough to catch text that was
 *  never restyled, without arguing about decorative greys. */
const MIN_CONTRAST = 3

/** Chrome that paints its own background. Transparent ones are skipped: what
 *  shows through them is measured where that surface is actually painted. */
const SURFACES = ['.editor-component', '.side-bar', '.title-bar-editor-bg']

interface Surface {
  selector: string
  luminance: number
  background: string
}

interface StrandedText {
  tag: string
  text: string
  contrast: number
  color: string
  background: string
}

interface Report {
  surfaces: Surface[]
  stranded: StrandedText[]
}

/** One pass over the page: how dark the chrome is, and any opaque text left
 *  below the contrast floor. Both need the same colour maths, so they share a
 *  single evaluate rather than shipping it twice. */
const inspect = (page: Page, selectors: string[], minContrast: number): Promise<Report> =>
  page.evaluate(
    ({ selectors, minContrast }) => {
      const channel = (value: number): number => {
        const c = value / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }

      type Rgba = [number, number, number, number]

      const parse = (value: string): Rgba | null => {
        const parts = String(value).match(/[\d.]+/g)
        if (!parts || parts.length < 3) return null
        const n = parts.map(Number)
        return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1]
      }

      const luminance = (c: Rgba): number =>
        0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])

      const rgb = (c: Rgba): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`

      const ownBackground = (el: Element): Rgba | null => {
        const parsed = parse(getComputedStyle(el).backgroundColor)
        return parsed && parsed[3] >= 0.9 ? parsed : null
      }

      // The nearest ancestor that actually paints. Correct for text, which sits
      // in normal flow inside the box painted behind it; it would NOT be correct
      // for a fixed or absolute element whose visual backdrop is a sibling,
      // which is why only text is measured this way.
      const surfaceBehind = (el: Element): Rgba => {
        let node: Element | null = el
        while (node) {
          const own = ownBackground(node)
          if (own) return own
          node = node.parentElement
        }
        return [255, 255, 255, 1]
      }

      const visible = (el: Element): boolean => {
        const box = el.getBoundingClientRect()
        if (box.width < 4 || box.height < 4) return false
        const style = getComputedStyle(el)
        return style.visibility !== 'hidden' && Number(style.opacity) > 0.1
      }

      const surfaces: Surface[] = []
      for (const selector of selectors) {
        const el = document.querySelector(selector)
        if (!el || !visible(el)) continue
        const own = ownBackground(el)
        if (!own) continue
        surfaces.push({
          selector,
          luminance: Math.round(luminance(own) * 1000) / 1000,
          background: rgb(own)
        })
      }

      const stranded: StrandedText[] = []
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const rendersText = Array.from(el.childNodes).some(
          (node) => node.nodeType === 3 && (node.textContent ?? '').trim().length > 1
        )
        if (!rendersText || !visible(el)) continue

        const color = parse(getComputedStyle(el).color)
        if (!color || color[3] < 0.95) continue

        const background = surfaceBehind(el)
        const a = luminance(color)
        const b = luminance(background)
        const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        if (contrast >= minContrast) continue

        stranded.push({
          tag: `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`,
          text: (el.textContent ?? '').trim().slice(0, 30),
          contrast: Math.round(contrast * 100) / 100,
          color: rgb(color),
          background: rgb(background)
        })
      }
      stranded.sort((x, y) => x.contrast - y.contrast)

      return { surfaces, stranded }
    },
    { selectors, minContrast }
  )

test.describe('the dark theme, in a real window', () => {
  let app: ElectronApplication
  let page: Page
  let report: Report

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

    report = await inspect(page, SURFACES, MIN_CONTRAST)
  })

  test.afterAll(async() => {
    if (app) await app.close()
  })

  test('darkens the chrome, not just the editor', () => {
    expect(
      report.surfaces.length,
      'no painted surface was found to measure'
    ).toBeGreaterThanOrEqual(2)

    for (const surface of report.surfaces) {
      expect(
        surface.luminance,
        `${surface.selector} stayed light (${surface.background})`
      ).toBeLessThan(0.25)
    }
  })

  test('leaves no hand-written colour stranded on a dark surface', () => {
    const detail = report.stranded
      .slice(0, 8)
      .map((t) => `  ${t.contrast}:1  ${t.tag}  ${t.color} on ${t.background}  "${t.text}"`)
      .join('\n')

    expect(report.stranded, `opaque text below ${MIN_CONTRAST}:1\n${detail}`).toEqual([])
  })
})
