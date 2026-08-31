// The loading screen has to survive as *markup in the document*.
//
// Its whole value is that it needs nothing but the document to paint — no
// stylesheet, no script, no image. Each of those is a round trip, and a round
// trip lands it after the app it was meant to cover for, at which point it is
// pure cost. That property is invisible in review: moving the styles into the
// app stylesheet or the mark into an <img> looks tidier and breaks it silently.
//
// See src/renderer/index.html for why it cannot be a component.

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

const html = readFileSync(resolve(__dirname, '../../../src/renderer/index.html'), 'utf8')

/** The comments explain why the splash is written the way it is, and quote the
 *  tags they warn against — so they have to come out before scanning for them. */
const markupOnly = html.replace(/<!--[\s\S]*?-->/g, '')

/** The `<div id="splash">…</div>` element, markup only. */
const splashMarkup = (): string => {
  const start = html.indexOf('<div id="splash">')
  expect(start, 'the splash element is gone from index.html').toBeGreaterThan(-1)
  const end = html.indexOf('</div>\n    <script', start)
  expect(end, 'could not find the end of the splash element').toBeGreaterThan(start)
  return html.slice(start, end)
}

describe('splash screen', () => {
  it('is in the document, not rendered by the app', () => {
    expect(html).toContain('<div id="splash">')
    expect(html).toContain('id="app"')
  })

  it('carries its own styles inline', () => {
    expect(html).toMatch(/<style>[\s\S]*#splash[\s\S]*<\/style>/)
  })

  it('fetches nothing', () => {
    const markup = splashMarkup()

    // An <img>, a <use xlink:href>, a background-image: url(…) — anything that
    // makes the frame wait on a second request.
    expect(markup, 'the splash must not reference an external resource').not.toMatch(
      /\b(?:src|href|xlink:href)\s*=/
    )
    expect(html.slice(html.indexOf('#splash'), html.indexOf('</style>')), 'no url() in the splash styles')
      .not.toContain('url(')
  })

  it('runs no script of its own', () => {
    // The CSP below is `script-src 'self'`, so an inline <script> would not run
    // at all — it would fail silently and leave the screen up forever.
    expect(html).toContain("script-src 'self'")

    const scripts = [...markupOnly.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1] as string)
    for (const attrs of scripts) {
      expect(attrs, 'every <script> in index.html must load from a file').toContain('src=')
    }
  })

  it('matches the window background the shell paints before it', () => {
    // tauri.conf.json fills the window with this before the document arrives.
    // A different value here is a visible colour change at first paint.
    const config = JSON.parse(
      readFileSync(resolve(__dirname, '../../../src-tauri/tauri.conf.json'), 'utf8')
    )
    const background = config.app.windows[0].backgroundColor as string

    expect(html.toLowerCase()).toContain(background.toLowerCase())
  })
})
