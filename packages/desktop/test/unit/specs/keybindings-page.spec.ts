// The Keybindings settings page has to show something true.
//
// It asked two channels for its data as it mounted and destructured both
// replies. Under Tauri an unanswered channel resolves `undefined`, so both
// destructures threw into a `.catch` that only writes to the log — leaving the
// page an empty table with a Save and a Restore Defaults button that did
// nothing and said nothing. That is the "silently broken" the rest of this
// shell has been careful to avoid: auto-update, by contrast, is absent from the
// menus entirely rather than present and dead.
//
// Two halves, and both are needed. The bridge now serves the real default table,
// so the page lists the shortcuts that are actually in force. And because
// nothing can yet write a custom binding — that needs a store the shell does not
// have and a native menu that would have to honour it — the editing controls are
// disabled and the page says why.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const read = (relative: string): string =>
  readFileSync(resolve(__dirname, '../../../src/renderer/src', relative), 'utf-8')

const page = read('prefComponents/keybindings/index.vue')
const bridge = read('tauri-bridge/index.ts')
const keybindings = read('tauri-bridge/keybindings.ts')

describe('the keybindings settings page', () => {
  it('is served the default table rather than left to the unhandled-channel path', () => {
    expect(bridge).toContain("'mt::keybinding-get-pref-keybindings'")
    expect(keybindings).toContain('getPrefKeybindings')
  })

  it('reports no user bindings, because none can be saved yet', () => {
    // Claiming one would be worse than showing none: the page marks anything in
    // this map as customised, and nothing here can honour a custom binding.
    expect(keybindings).toMatch(/userKeybindings:\s*new Map\(\)/)
  })

  it('survives a reply that never came instead of throwing into a log', () => {
    // The shape that caused it — destructuring in the `.then` signature — must
    // not come back.
    expect(page, 'guard the keyboard-info reply').toMatch(/\.then\(\(info\) => \{[\s\S]*?if \(!info\) return/)
    expect(page, 'guard the keybindings reply').toMatch(/\.then\(\(tables\) => \{[\s\S]*?if \(!tables\) return/)
    expect(page).not.toMatch(/\.then\(\(\{ layout, keymap \}\)/)
    expect(page).not.toMatch(/\.then\(\(\{ defaultKeybindings, userKeybindings \}\)/)
  })

  it('disables every control that would pretend to change a binding', () => {
    // Five: edit, reset and unbind on each row, then Save and Restore Defaults.
    const disabled = page.match(/:disabled="!canEdit"/g) ?? []
    expect(disabled).toHaveLength(5)
  })

  it('says why, rather than leaving disabled buttons unexplained', () => {
    expect(page).toContain("t('preferences.keybindings.editingUnavailable')")
    expect(page).toContain('v-if="!canEdit"')
  })

  it('still allows editing under the shell that can honour it', () => {
    // `canEdit` is about the shell, not about a preference or a build flag —
    // the Electron build reaches the main process that owns the file.
    expect(page).toMatch(/const canEdit = computed\(\(\) => !isTauri\(\)\)/)
  })
})
