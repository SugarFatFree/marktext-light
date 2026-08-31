// The keybinding table, in place of the Electron main process's keyboard layer
// (src/main/keyboard/shortcutHandler.ts).
//
// The command palette shows a shortcut beside each entry and asks for the table
// on startup, and the settings window shows the whole table. Only the defaults
// are served: user-defined keybindings lived in a file the Electron
// `Keybindings` class owned, and nothing reads or writes that file here yet — so
// a customised binding shows its default everywhere.
//
// Serving the defaults is not cosmetic. The settings page destructured the reply
// to this channel, and an unimplemented channel resolves with `undefined`, so
// the destructure threw into a `.catch` that only logs — leaving the Keybindings
// page an empty table with buttons that did nothing and said nothing. A page
// that lists the real shortcuts and says editing is unavailable is a different
// thing from a page that looks broken.

import darwin from 'common/keybindings/darwin'
import linux from 'common/keybindings/linux'
import windows from 'common/keybindings/windows'

import type { DispatchLocal } from './save'

const tableFor = (platform: string): Map<string, string> => {
  if (platform === 'darwin') return darwin
  if (platform === 'win32') return windows
  return linux
}

/**
 * Answer `mt::request-keybindings`.
 *
 * The palette indexes by command id and skips empty values, so the table goes
 * over as a plain object — entries with no default binding included, since the
 * consumer already ignores them.
 */
export const sendKeybindings = (dispatchLocal: DispatchLocal, platform: string): void => {
  dispatchLocal('mt::keybindings-response', [Object.fromEntries(tableFor(platform))])
}

/**
 * Answer `mt::keybinding-get-pref-keybindings`, which the settings window asks
 * for as it mounts.
 *
 * `userKeybindings` is always empty: there is nowhere to save one yet, and an
 * entry here would claim otherwise. The settings page marks anything absent from
 * it as a default binding, which is exactly what every binding currently is.
 *
 * Maps, not objects — `KeybindingConfigurator` iterates both with `for…of` and
 * calls `.get`, matching what the Electron handler returned.
 */
export const getPrefKeybindings = (
  platform: string
): { defaultKeybindings: Map<string, string>, userKeybindings: Map<string, string> } => ({
  defaultKeybindings: tableFor(platform),
  userKeybindings: new Map()
})
