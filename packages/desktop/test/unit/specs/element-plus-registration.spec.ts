// Which Element Plus components each window registers.
//
// They used to be registered globally at startup, for both windows. The
// settings-only ones — the table, the select, the slider and friends — cost the
// editor window 141 KB of first paint for markup it never renders, so they moved
// to the settings tree, which loads on demand.
//
// The failure that split invites is silent: a `<el-input>` added to an editor
// component resolves to nothing, Vue warns in the console, and the control is
// simply absent. So the split is checked against the tags actually written in
// each tree, not trusted to stay correct.
//
// CLAUDE.md already warns that adding an `<el-…>` tag means editing main.ts.
// This is that warning, enforced.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, relative } from 'path'

const RENDERER = resolve(__dirname, '../../../src/renderer/src')

const vueFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...vueFiles(path))
    else if (entry.endsWith('.vue')) out.push(path)
  }
  return out
}

/** `el-foo-bar` -> `ElFooBar`, the name each component registers under. */
const toPascal = (tag: string): string =>
  tag
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')

const tagsIn = (source: string): Set<string> =>
  new Set([...source.matchAll(/<(el-[a-z0-9-]+)/g)].map((m) => m[1] as string))

const isSettingsTree = (path: string): boolean =>
  path.includes('/prefComponents/') || path.endsWith('/pages/preference.vue')

const registeredIn = (file: string, listName: string): Set<string> => {
  const source = readFileSync(resolve(RENDERER, file), 'utf-8')
  const start = source.indexOf(listName)
  expect(start, `${listName} moved`).toBeGreaterThan(-1)
  const list = source.slice(start, source.indexOf(']', start))

  return new Set([...list.matchAll(/\bEl[A-Za-z]+\b/g)].map((m) => m[0] as string))
}

describe('Element Plus registration', () => {
  const editorEager = registeredIn('main.ts', 'const ELEMENT_PLUS_COMPONENTS = [')
  const settingsOnly = registeredIn('prefComponents/settingsComponents.ts', 'const SETTINGS_ONLY = [')

  it('covers every tag the editor window renders', () => {
    const missing: string[] = []
    for (const path of vueFiles(RENDERER)) {
      if (isSettingsTree(path)) continue
      for (const tag of tagsIn(readFileSync(path, 'utf-8'))) {
        if (!editorEager.has(toPascal(tag))) missing.push(`${relative(RENDERER, path)}: <${tag}>`)
      }
    }

    expect(missing, 'used in the editor window but not registered in main.ts').toEqual([])
  })

  it('covers every tag the settings window renders', () => {
    const known = new Set([...editorEager, ...settingsOnly])
    const missing: string[] = []
    for (const path of vueFiles(RENDERER)) {
      if (!isSettingsTree(path)) continue
      for (const tag of tagsIn(readFileSync(path, 'utf-8'))) {
        if (!known.has(toPascal(tag))) missing.push(`${relative(RENDERER, path)}: <${tag}>`)
      }
    }

    expect(missing, 'used in settings but registered nowhere').toEqual([])
  })

  it('keeps the deferred set out of the editor window', () => {
    // The point of the split. A component here that the editor also uses would
    // be missing at runtime, which is what the first case above would catch —
    // this one names the overlap directly.
    const used: string[] = []
    for (const path of vueFiles(RENDERER)) {
      if (isSettingsTree(path)) continue
      for (const tag of tagsIn(readFileSync(path, 'utf-8'))) {
        if (settingsOnly.has(toPascal(tag))) used.push(`${relative(RENDERER, path)}: <${tag}>`)
      }
    }

    expect(used, 'deferred to the settings tree but rendered in the editor').toEqual([])
  })

  it('does not defer anything twice', () => {
    const both = [...settingsOnly].filter((name) => editorEager.has(name))

    expect(both, 'registered eagerly and deferred').toEqual([])
  })

  // Each window imports styles for exactly the components it registers, in
  // place of the library's 349 KB stylesheet. That trade buys back half the
  // entry's render-blocking CSS and costs a second list to keep in step — a
  // component registered without its styles renders unstyled, which no test
  // above would notice and no console warning announces.
  describe('per-component styles', () => {
    const styleImportsIn = (file: string): Set<string> => {
      const source = readFileSync(resolve(RENDERER, file), 'utf-8')
      const matches = source.matchAll(/element-plus\/es\/components\/([a-z0-9-]+)\/style\/css/g)

      // `…/table-column/style/css` -> `ElTableColumn`, matching the lists above.
      return new Set([...matches].map((m) => `El${toPascal(m[1] as string)}`))
    }

    it.each([
      ['the editor window', 'main.ts', editorEager],
      ['the settings window', 'prefComponents/settingsComponents.ts', settingsOnly]
    ])('imports styles for exactly what %s registers', (_who, file, registered) => {
      expect([...styleImportsIn(file)].sort()).toEqual([...registered].sort())
    })
  })
})
