import { ref } from 'vue'
import { defineStore } from 'pinia'

// Recently-opened documents shown in the sidebar's "files" panel.
//
// Distinct from the tab list: tabs are session state and are deliberately not
// restored, while this list survives a restart so the drawer still offers the
// documents you were working on. Entries only leave the list when the user
// removes them (or the cap below evicts the oldest).
//
// localStorage rather than the preferences file: it is renderer-local, needs no
// round trip through the shell, and is available identically under Electron and
// Tauri.

const STORAGE_KEY = 'recent-files'
const MAX_ENTRIES = 50

export interface RecentFile {
  pathname: string
  filename: string
  /** Epoch ms of the most recent open; the list is sorted by this, descending. */
  lastOpenedAt: number
}

const basename = (pathname: string): string => {
  const normalized = pathname.replace(/[\\/]+$/, '')
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  return index === -1 ? normalized : normalized.slice(index + 1)
}

const isRecentFile = (value: unknown): value is RecentFile => {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<RecentFile>
  return typeof entry.pathname === 'string' && entry.pathname.length > 0
}

const read = (): RecentFile[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentFile).map((entry) => ({
      pathname: entry.pathname,
      filename: entry.filename || basename(entry.pathname),
      lastOpenedAt: Number(entry.lastOpenedAt) || 0
    }))
  } catch {
    // A corrupt entry must not stop the editor from booting.
    return []
  }
}

export const useRecentFilesStore = defineStore('recentFiles', () => {
  const recentFiles = ref<RecentFile[]>(read())

  const persist = (): void => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recentFiles.value))
    } catch {
      // Quota or a locked-down WebView: keep the in-memory list usable anyway.
    }
  }

  /** Record an opened document, moving an already-known path back to the top. */
  function ADD_RECENT_FILE(pathname: string | null | undefined): void {
    if (!pathname) return
    const filename = basename(pathname)
    const rest = recentFiles.value.filter((entry) => entry.pathname !== pathname)
    recentFiles.value = [{ pathname, filename, lastOpenedAt: Date.now() }, ...rest].slice(
      0,
      MAX_ENTRIES
    )
    persist()
  }

  function REMOVE_RECENT_FILE(pathname: string): void {
    recentFiles.value = recentFiles.value.filter((entry) => entry.pathname !== pathname)
    persist()
  }

  function CLEAR_RECENT_FILES(): void {
    recentFiles.value = []
    persist()
  }

  return {
    recentFiles,
    ADD_RECENT_FILE,
    REMOVE_RECENT_FILE,
    CLEAR_RECENT_FILES
  }
})
