// User preferences and user data, in place of the Electron main process's
// electron-store instances (src/main/preferences + src/main/dataCenter).
//
// Both are persisted as JSON under the user-data directory, the way
// electron-store did, so the files stay inspectable and a future Rust-side
// reader (the native menu needs `autoSave`, `theme`, …) can pick them up.
//
// Only the user's *overrides* are stored: the renderer's preferences store
// already carries the full default state and merges whatever arrives on
// `mt::user-preference` on top of it.

import { invoke } from '@tauri-apps/api/core'
import { open as showOpenDialog } from '@tauri-apps/plugin-dialog'
import pathe from 'pathe'

type Bag = Record<string, unknown>

interface Store {
  path: string
  values: Bag
  loaded: boolean
  writeTimer: ReturnType<typeof setTimeout> | null
}

const createStore = (): Store => ({ path: '', values: {}, loaded: false, writeTimer: null })

const preferences = createStore()
const userData = createStore()

/** Point both stores at the user-data directory reported by `boot_info`. */
export const initPreferenceStores = (userDataDir: string): void => {
  if (!userDataDir) {
    console.warn('[tauri-bridge] no user-data dir; preferences will not persist')
    return
  }
  preferences.path = pathe.join(userDataDir, 'preferences.json')
  userData.path = pathe.join(userDataDir, 'dataCenter.json')
}

const read = async(store: Store): Promise<Bag> => {
  if (store.loaded || !store.path) return store.values
  store.loaded = true
  try {
    if (!(await invoke('path_exists', { path: store.path }))) return store.values
    const raw = await invoke('read_file', { path: store.path, encoding: 'utf8' })
    const parsed: unknown = JSON.parse(String(raw))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      store.values = parsed as Bag
    }
  } catch (err) {
    // A hand-edited file with a syntax error must not stop the app from
    // starting; fall back to defaults and let the next write repair it.
    console.error(`[tauri-bridge] cannot read ${store.path}:`, err)
  }
  return store.values
}

// Preference edits arrive one key at a time (every toggle in the settings
// window is its own `mt::set-user-preference`), so coalesce them.
const WRITE_DELAY = 300

const scheduleWrite = (store: Store): void => {
  if (!store.path) return
  if (store.writeTimer) clearTimeout(store.writeTimer)
  store.writeTimer = setTimeout(() => {
    store.writeTimer = null
    invoke('output_file', {
      path: store.path,
      data: JSON.stringify(store.values, null, 2)
    }).catch((err) => console.error(`[tauri-bridge] cannot write ${store.path}:`, err))
  }, WRITE_DELAY)
}

const merge = async(store: Store, patch: unknown): Promise<void> => {
  if (!patch || typeof patch !== 'object') return
  await read(store)
  Object.assign(store.values, patch as Bag)
  scheduleWrite(store)
}

type DispatchLocal = (channel: string, args: unknown[]) => void

/**
 * Answer `mt::ask-for-user-preference` / `mt::ask-for-user-data`. Upstream
 * replies to both on the single `mt::user-preference` channel, and the store
 * merges each payload, so sending the two bags separately is correct.
 */
export const sendStoredPreferences = async(dispatchLocal: DispatchLocal): Promise<void> => {
  dispatchLocal('mt::user-preference', [await read(preferences)])
}

export const sendStoredUserData = async(dispatchLocal: DispatchLocal): Promise<void> => {
  dispatchLocal('mt::user-preference', [await read(userData)])
}

export const setStoredPreferences = (patch: unknown): Promise<void> => merge(preferences, patch)

export const setStoredUserData = (patch: unknown): Promise<void> => merge(userData, patch)

/** Read one preference without waiting for a round trip through the store. */
export const getStoredPreference = async(key: string): Promise<unknown> =>
  (await read(preferences))[key]

/**
 * Pick a folder and store it under `key`, then push the new value back so the
 * settings UI reflects it — the store learns about preference changes only
 * through `mt::user-preference`.
 *
 * `preset` short-circuits the dialog: the image-folder setting can be typed in
 * as well as browsed for, and Electron accepted both on the same channel.
 */
export const pickFolderPreference = async(
  key: string,
  dispatchLocal: DispatchLocal,
  preset?: string
): Promise<void> => {
  let chosen = preset
  if (!chosen) {
    const current = await getStoredPreference(key)
    const selected = await showOpenDialog({
      directory: true,
      defaultPath: typeof current === 'string' && current ? current : undefined
    })
    if (typeof selected !== 'string') return
    chosen = selected
  }

  await setStoredPreferences({ [key]: chosen })
  dispatchLocal('mt::user-preference', [{ [key]: chosen }])
}
