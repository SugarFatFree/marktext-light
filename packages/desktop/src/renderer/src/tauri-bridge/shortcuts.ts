// Tab-navigation shortcuts.
//
// Electron bound these in the main process through its command manager and
// pushed `mt::tabs-cycle-*` / `mt::switch-tab-by-index` to the renderer. Tauri
// has no equivalent for accelerators that are not menu items, and adding a
// dozen hidden entries to the native menu just to carry them would be worse, so
// they are recognised here and dispatched onto the same channels the renderer
// already listens on.
//
// Bindings match `src/main/keyboard/keybindings*.ts`; macOS uses Cmd for the
// page-up/down pair and Ctrl for the rest, exactly as the Darwin table does.

import type { DispatchLocal } from './save'

/** Cmd on macOS for the page-up/down pair, Ctrl everywhere else. */
const pageModifier = (event: KeyboardEvent, isMac: boolean): boolean =>
  isMac ? event.metaKey : event.ctrlKey

const channelFor = (event: KeyboardEvent, isMac: boolean): [string, unknown[]] | null => {
  // `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle; on macOS too — the Darwin table keeps
  // Ctrl here because Cmd+Tab belongs to the OS.
  if (event.ctrlKey && !event.altKey && event.key === 'Tab') {
    return [event.shiftKey ? 'mt::tabs-cycle-left' : 'mt::tabs-cycle-right', []]
  }

  if (pageModifier(event, isMac) && !event.altKey && !event.shiftKey) {
    if (event.key === 'PageUp') return ['mt::tabs-cycle-left', []]
    if (event.key === 'PageDown') return ['mt::tabs-cycle-right', []]
  }

  // Ctrl+1…9 select that tab, Ctrl+0 the tenth. Alt must be up: Ctrl+Alt+<n>
  // is the heading shortcut.
  if (event.ctrlKey && !event.altKey && !event.shiftKey && /^[0-9]$/.test(event.key)) {
    const digit = Number(event.key)
    return ['mt::switch-tab-by-index', [digit === 0 ? 9 : digit - 1]]
  }

  return null
}

export const installTabShortcuts = (dispatchLocal: DispatchLocal, platform: string): void => {
  const isMac = platform === 'darwin'

  window.addEventListener(
    'keydown',
    (event) => {
      const match = channelFor(event, isMac)
      if (!match) return
      // These never reach the editor: Ctrl+Tab would otherwise move focus and
      // Ctrl+<n> is unbound there, but claiming them explicitly keeps the
      // behaviour the same whatever has focus.
      event.preventDefault()
      dispatchLocal(match[0], match[1])
    },
    // Capture, so a focused input or the editor cannot swallow them first.
    true
  )
}
