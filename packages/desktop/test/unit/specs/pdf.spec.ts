import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'

// `@/util/pdf` reads `window.path.join` and (for disk themes)
// `window.marktext.paths` / `window.fileUtils` — all of them inside
// `getCssForOptions`, at call time, never while the module loads. So a test
// changes what the module sees by assigning to those globals, and the module
// itself is imported once, statically, below.
//
// It used to be re-imported per test behind `vi.resetModules()`, which bought
// nothing (see above) and cost a great deal: `@/util/pdf` pulls in
// `@muyajs/core`, and the first import of that graph is ~2.4 s on an idle
// machine. Paid inside a test, that is half the 5 s budget before the test
// starts; under a full-suite run the file failed roughly one time in fourteen,
// always with a timeout on whichever test drew the cold import, and never when
// run alone. As a static import it is paid once, during the file's load phase,
// which no test's timeout applies to.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string, join: (...parts: string[]) => string }
      marktext?: { paths: { userDataPath: string } }
      fileUtils?: { isFile: (p: string) => Promise<boolean>, readFile: (p: string) => Promise<unknown> }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', join: (...parts: string[]) => parts.join('/') }
  w.window.marktext ??= { paths: { userDataPath: '/userData' } }
  w.window.fileUtils ??= { isFile: async() => false, readFile: async() => '' }
})

import { getCssForOptions, getHtmlToc } from '@/util/pdf'

// NOTE: `academic.theme.css?inline` / `liber.theme.css?inline` resolve to an
// EMPTY string under vitest (no CSS `?inline` transform is configured), so the
// academic/liber branch contributes no CSS in this environment. We therefore
// characterize the branch *dispatch* (academic/liber take the inline path and
// never touch `window.fileUtils`/`window.marktext`, unlike a disk theme name)
// rather than asserting a theme-specific selector token, which is unavailable
// here.

describe('getCssForOptions', () => {
  // Restored before *and* after each test. Before, because a test may have
  // replaced them; after, because a test that times out mid-way is abandoned
  // where it stands, and one of these tests borrows the globals — a `finally`
  // inside it is not reached when the test is abandoned, which is how a single
  // slow import used to take the three tests after it down with it.
  const install = (): void => {
    const w = globalThis as unknown as {
      window: {
        marktext: { paths: { userDataPath: string } }
        fileUtils: { isFile: (p: string) => Promise<boolean>, readFile: (p: string) => Promise<unknown> }
      }
    }
    w.window.marktext = { paths: { userDataPath: '/userData' } }
    w.window.fileUtils = { isFile: async() => false, readFile: async() => '' }
  }

  beforeEach(install)
  afterEach(install)

  it('academic/liber take the inline-theme branch (no disk access required)', async() => {
    // Remove the disk surfaces entirely: if academic/liber tried a disk read
    // these would throw. They must not. `afterEach` puts them back.
    const w = globalThis as unknown as { window: Record<string, unknown> }
    delete w.window.marktext
    delete w.window.fileUtils

    await expect(getCssForOptions({ theme: 'academic' })).resolves.toBeTypeOf('string')
    await expect(getCssForOptions({ theme: 'liber' })).resolves.toBeTypeOf('string')
  })

  it('appends no theme CSS for theme:"default" (disk lookup misses) or {}', async() => {
    // 'default' is NOT special-cased: it falls into the disk branch, which
    // reads window.marktext.paths + window.fileUtils.isFile (→ false here).
    const def = await getCssForOptions({ theme: 'default' })
    const empty = await getCssForOptions({})

    // Both produce the same base stylesheet (no theme block appended).
    expect(def).toBe(empty)
    expect(def).not.toContain('Georgia')
    expect(def).toContain('.markdown-body{')
  })

  it('reads a custom theme name from disk via window.fileUtils', async() => {
    const isFile = vi.fn(async() => true)
    const readFile = vi.fn(async() => '.custom{}')
    const w = globalThis as unknown as {
      window: { fileUtils: { isFile: typeof isFile, readFile: typeof readFile } }
    }
    w.window.fileUtils = { isFile, readFile }

    const css = await getCssForOptions({ theme: 'mytheme' })

    expect(css).toContain('.custom{}')
    expect(isFile).toHaveBeenCalledWith('/userData/themes/export/mytheme')
  })

  it('omits the disk theme CSS when the theme file is absent', async() => {
    const w = globalThis as unknown as {
      window: { fileUtils: { isFile: () => Promise<boolean>, readFile: () => Promise<unknown> } }
    }
    w.window.fileUtils = { isFile: async() => false, readFile: async() => '.custom{}' }

    const css = await getCssForOptions({ theme: 'mytheme' })

    expect(css).not.toContain('.custom{}')
  })

  it('round-trips a disk theme containing CSS child-combinator (>) selectors', async() => {
    // The whole stylesheet is escapeHTML → sanitize → unescapeHTML'd, so a `>`
    // in a theme selector must survive the round-trip unmangled.
    const w = globalThis as unknown as {
      window: { fileUtils: { isFile: () => Promise<boolean>, readFile: () => Promise<string> } }
    }
    w.window.fileUtils = { isFile: async() => true, readFile: async() => '.a > .b{color:red}' }

    const css = await getCssForOptions({ theme: 'mytheme' })

    expect(css).toContain('.a > .b{color:red}')
  })

  it('emits font-family/size/line-height rules into .markdown-body', async() => {
    const css = await getCssForOptions({ fontFamily: 'Foo', fontSize: 14, lineHeight: 1.6 })

    expect(css).toContain('font-family:"Foo"')
    expect(css).toContain('font-size:14px;')
    expect(css).toContain('line-height:1.6;')
    // The font-family also seeds the header/footer container.
    expect(css).toContain('.hf-container{font-family:"Foo"')
  })

  it('emits the font override AFTER theme CSS so "overwrite theme font" wins', async() => {
    // A selected export theme sets its own `.markdown-body { font-size/line-height/
    // font-family }`. The whole point of the "Overwrite theme font" toggle is that
    // the user's font wins over the theme — so the override rule must be emitted
    // AFTER the theme block (same specificity → later wins), otherwise the theme
    // silently clobbers the user's font size / line height / family.
    const w = globalThis as unknown as {
      window: { fileUtils: { isFile: () => Promise<boolean>, readFile: () => Promise<string> } }
    }
    w.window.fileUtils = {
      isFile: async() => true,
      readFile: async() => '.markdown-body{font-size:99px;line-height:9;font-family:"Theme";}'
    }

    const css = await getCssForOptions({
      theme: 'mytheme',
      fontFamily: 'Foo',
      fontSize: 14,
      lineHeight: 1.6
    })

    const themeAt = css.indexOf('font-size:99px')
    const overrideAt = css.indexOf('font-size:14px;')
    expect(themeAt).toBeGreaterThanOrEqual(0)
    expect(overrideAt).toBeGreaterThanOrEqual(0)
    // The user's override must come after the theme rule to win the cascade.
    expect(overrideAt).toBeGreaterThan(themeAt)
  })

  it('adds heading auto-numbering CSS when autoNumberingHeadings is set', async() => {
    const css = await getCssForOptions({ autoNumberingHeadings: true })

    expect(css).toContain('counter-reset')
    expect(css).toContain('h2:before')
  })

  it('hides front matter when showFrontMatter is false, not when true', async() => {
    const hidden = await getCssForOptions({ showFrontMatter: false })
    const shown = await getCssForOptions({ showFrontMatter: true })

    expect(hidden).toContain('pre.front-matter{display:none')
    expect(shown).not.toContain('pre.front-matter{display:none')
  })

  it('emits header/footer font-size rules when headerFooterFontSize is set', async() => {
    const css = await getCssForOptions({ headerFooterFontSize: 9 })

    expect(css).toContain('font-size: 9px;')
    expect(css).toContain('.page-header .hf-container')
  })

  it('wraps printable CSS in an @media print @page block by default', async() => {
    const printable = await getCssForOptions({})
    const styledHtml = await getCssForOptions({ type: 'styledHtml' })

    expect(printable).toContain('@media print{@page{')
    // type === 'styledHtml' is the only non-printable mode.
    expect(styledHtml).not.toContain('@media print')
  })
})

describe('getHtmlToc', () => {
  it('renders a "Table of Contents" title and excludes the top H1 by default', async() => {
    const toc = [
      { lvl: 1, content: 'Top' },
      { lvl: 2, content: 'Sub' }
    ]
    const html = getHtmlToc(toc, {})

    expect(html).toContain('class="toc-title"')
    expect(html).toContain('Table of Contents')
    // Top H1 is dropped, its sub-heading is kept.
    expect(html).not.toContain('href="#top"')
    expect(html).toContain('href="#sub"')
  })

  it('includes the top heading and honors a custom tocTitle', async() => {
    const toc = [
      { lvl: 1, content: 'Top' },
      { lvl: 2, content: 'Sub' }
    ]
    const html = getHtmlToc(toc, { tocTitle: 'Contents', tocIncludeTopHeading: true })

    expect(html).toContain('Contents')
    expect(html).toContain('href="#top"')
    expect(html).toContain('href="#sub"')
  })

  it('clones its input — repeated calls are stable (the helper shifts internally)', async() => {
    const toc = [
      { lvl: 1, content: 'Top' },
      { lvl: 2, content: 'Sub' }
    ]
    const first = getHtmlToc(toc, { tocIncludeTopHeading: true })
    const second = getHtmlToc(toc, { tocIncludeTopHeading: true })

    expect(second).toBe(first)
    // The caller's array is untouched (no shift leaked out).
    expect(toc).toHaveLength(2)
    expect(toc[0]).toEqual({ lvl: 1, content: 'Top' })
  })

  it('dedups identical heading slugs in document order with -N suffixes', async() => {
    const toc = [
      { lvl: 2, content: 'Installation' },
      { lvl: 2, content: 'Installation' }
    ]
    const html = getHtmlToc(toc, { tocIncludeTopHeading: true })

    expect(html).toContain('href="#installation"')
    expect(html).toContain('href="#installation-1"')
  })

  it('returns an empty string when the TOC has no qualifying entries', async() => {
    // A lone top-level H1 is shifted away by the default (exclude-top) path,
    // leaving nothing to render.
    expect(getHtmlToc([{ lvl: 1, content: 'Only' }], {})).toBe('')
    expect(getHtmlToc([], {})).toBe('')
  })
})
