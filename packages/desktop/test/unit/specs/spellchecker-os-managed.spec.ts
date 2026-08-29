// The spell checker the platform already provides.
//
// This was written down as a hard gap: Electron's spell checker is a Chromium
// API with no Tauri equivalent, so the five `mt::spellchecker-*` channels have
// no backend here. That is true, and it overstated the damage — muya sets
// `spellcheck` on the editor from the `spellcheckEnabled` preference, and the
// WebView underlines misspellings from the system dictionaries without anyone
// asking it to. The same is already true of macOS in the Electron build, which
// is why the settings panel had a shape for it.
//
// What is genuinely missing is everything around it: listing dictionaries,
// switching language in-app, and correcting from the context menu.
//
// The bug this fixes: those controls were shown anyway, and populating them
// called channels nothing answers. An unrouted invoke resolves to `undefined`,
// and the panel called `.map` on it — so opening spell-check settings threw.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const RENDERER = resolve(__dirname, '../../../src/renderer/src')
const read = (relative: string): string => readFileSync(resolve(RENDERER, relative), 'utf-8')

describe('spell-check settings', () => {
  const panel = read('prefComponents/spellchecker/index.vue')
  const module_ = read('spellchecker/index.ts')

  it('treat the WebView like macOS: the system owns it', () => {
    expect(panel).toMatch(/const osManagedSpellcheck = isOsx \|\| isTauri\(\)/)
    expect(module_).toMatch(/if \(isOsx \|\| isTauri\(\)\)/)
  })

  it('do not ask for a dictionary list that nothing answers', () => {
    // `getAvailableDictionaries` must return before the invoke on those
    // platforms — the caller maps over the result, and undefined does not map.
    const fn = module_.slice(module_.indexOf('static async getAvailableDictionaries'))
    const guard = fn.indexOf('isTauri()')
    const request = fn.indexOf('mt::spellchecker-get-available-dictionaries')

    expect(guard).toBeGreaterThan(-1)
    expect(guard).toBeLessThan(request)
  })

  it('hide the controls the platform does not back', () => {
    // Language picker and custom dictionary: both need a backend this build has
    // no equivalent for. Shown, they would look broken rather than absent.
    expect(panel).toMatch(/v-show="!osManagedSpellcheck"/)
    expect(panel).toMatch(/v-if="!osManagedSpellcheck && spellcheckerEnabled"/)
    expect(panel).not.toMatch(/v-(show|if)="!?isOsx/)
  })

  it('still let the editor be told to spellcheck', () => {
    // The part that does work: the preference reaches muya, which sets the
    // attribute the WebView acts on.
    const editor = read('components/editorWithTabs/editor.vue')

    expect(editor).toMatch(/spellcheckEnabled: spellcheckerEnabled\.value/)
    expect(editor).toMatch(/setOptions\(\{ spellcheckEnabled: value \}\)/)
  })
})
