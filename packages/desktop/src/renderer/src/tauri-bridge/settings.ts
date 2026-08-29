// The preferences window and the language handshake, in place of the Electron
// main process's `_openSettingsWindow` and its language broadcast
// (src/main/app/index.ts).
//
// Preferences live at the `/preference` route of the same bundle; the router
// picks it whenever the `type` URL argument is anything but `editor`. So this
// opens a second Tauri window onto the same `index.html` with `type=settings`,
// exactly as the Electron build built its URL.

import { emit } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

import type { DispatchLocal } from './save'
import { getStoredPreference } from './preferences'
import { resolveInitialTheme } from './theme'

const SETTINGS_LABEL = 'settings'

/**
 * Open the preferences window, or focus it and switch tabs if it is already up.
 *
 * `category` selects a tab; the Electron build encoded it as `type=settings/x`
 * and pushed `settings::change-tab` at an existing window, and both paths are
 * kept so the renderer's callers are unchanged.
 */
export const openSettingsWindow = async(
  category: string | null,
  userDataPath: string
): Promise<void> => {
  const existing = await WebviewWindow.getByLabel(SETTINGS_LABEL)
  if (existing) {
    await existing.setFocus()
    // A cross-window push: the bridge's local bus only reaches this window.
    await emit('settings::change-tab', category)
    return
  }

  const params = new URLSearchParams({
    type: category ? `settings/${category}` : 'settings',
    wid: '2',
    udp: userDataPath || '/tmp',
    theme: resolveInitialTheme(),
    debug: '0',
    hsb: '0',
    tbs: 'custom'
  })

  const settings = new WebviewWindow(SETTINGS_LABEL, {
    url: `index.html?${params.toString()}`,
    title: 'MarkText',
    width: 950,
    height: 650,
    minWidth: 800,
    minHeight: 500,
    decorations: false,
    resizable: true
  })

  settings.once('tauri://error', (event) => {
    console.error('[tauri-bridge] cannot open the settings window:', event.payload)
  })
}

/**
 * Answer `mt::get-current-language`.
 *
 * The renderer asks once at startup and then follows `language-changed`. The
 * stored preference wins; `bootLocale` is the OS language the Rust side already
 * resolved to an available translation.
 */
export const sendCurrentLanguage = async(
  dispatchLocal: DispatchLocal,
  bootLocale: string
): Promise<void> => {
  const stored = await getStoredPreference('language')
  dispatchLocal('mt::current-language', [typeof stored === 'string' ? stored : bootLocale])
}

/** Tell every window the language changed — both of them run their own i18n. */
export const broadcastLanguage = (language: string): void => {
  emit('language-changed', language).catch((err) =>
    console.warn('[tauri-bridge] cannot broadcast the language change:', err)
  )
}
