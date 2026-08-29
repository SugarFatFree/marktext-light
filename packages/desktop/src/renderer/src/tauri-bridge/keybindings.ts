// The keybinding table, in place of the Electron main process's keyboard layer
// (src/main/keyboard/shortcutHandler.ts).
//
// The command palette shows a shortcut beside each entry and asks for the table
// on startup. Only the defaults are served: user-defined keybindings live in a
// file the Electron `Keybindings` class owned, and nothing reads or writes that
// file here yet — so a customised binding shows its default in the palette.

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
