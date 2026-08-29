// The native menu and the custom menu bar have to offer the same commands.
//
// Two files describe one menu: `src-tauri/src/menu/mod.rs` builds the native
// one, and `components/menuBar/structure.ts` draws the bar that replaces it on
// frameless Windows/Linux, where a native menu bar cannot render. A command
// added to one and not the other is missing for half the users, and nothing
// about either file makes that visible — they are not even the same language.
//
// Both are read as text. Running the Rust is not an option here, and the ids
// are literals in both, so the comparison is exact where it matters.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const DESKTOP = resolve(__dirname, '../../..')
const NATIVE = resolve(DESKTOP, 'src-tauri/src/menu/mod.rs')
const BAR = resolve(DESKTOP, 'src/renderer/src/components/menuBar/structure.ts')
// The same file the Rust side loads at runtime to translate its menu.
const EN = resolve(DESKTOP, 'static/locales/en.json')

const all = (source: string, pattern: RegExp): string[] =>
  [...source.matchAll(pattern)].map((match) => match[1] as string)

const native = readFileSync(NATIVE, 'utf-8')
const bar = readFileSync(BAR, 'utf-8')

// Cut/copy/paste/quit and friends are `PredefinedMenuItem`s: the OS supplies
// both the label and the behaviour, and the WebView already handles them
// without a menu, which is why the bar does not draw them.
const nativeIds = new Set(all(native, /item\(app,\s*"([^"]+)"/g))
const barIds = new Set(all(bar, /id:\s*'([^']+)'/g))

describe('the two menus', () => {
  it('offer the same commands', () => {
    expect([...nativeIds].filter((id) => !barIds.has(id)), 'in the native menu only').toEqual([])
    expect([...barIds].filter((id) => !nativeIds.has(id)), 'in the custom bar only').toEqual([])
  })

  it('keep Preferences reachable where there is no application menu', () => {
    // macOS puts it in the application menu, which is `#[cfg]`-gated. Off
    // macOS that menu does not exist, so the File menu has to carry it or
    // settings cannot be opened from a menu at all.
    expect(native).toMatch(/#\[cfg\(not\(target_os = "macos"\)\)\][\s\S]{0,400}cmd:file\.preferences/)
    expect(barIds.has('cmd:file.preferences')).toBe(true)
  })

  it('name labels that the translations actually define', () => {
    const en = JSON.parse(readFileSync(EN, 'utf-8')) as Record<string, unknown>
    const lookup = (key: string): unknown =>
      key.split('.').reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
        en
      )

    const keys = [...all(native, /tr\.t\("(menu\.[^"]+)"\)/g), ...all(bar, /labelKey:\s*'([^']+)'/g)]
    expect(keys.length).toBeGreaterThan(100)

    // A key with no translation renders as the raw key — visible, but only to
    // whoever opens that menu on that platform.
    expect(keys.filter((key) => typeof lookup(key) !== 'string')).toEqual([])
  })
})
