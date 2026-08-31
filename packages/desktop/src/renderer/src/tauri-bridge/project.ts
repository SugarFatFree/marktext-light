// Opening a folder in the sidebar, in place of the Electron main process's
// folder dialog + chokidar watcher (src/main/filesystem/watcher.ts).
//
// The project store builds its tree from a stream of `mt::update-object-tree`
// events rather than one listing, so the scan is replayed as the same
// `addDir` / `add` events the watcher used to send. Once the scan is done a
// Rust watcher takes over and emits the same shapes for later changes.
//
// Both are given the `treePathExcludePatterns` preference, matched the way
// upstream did with minimatch's `matchBase` (see src-tauri/src/commands/glob.rs).

import { invoke } from '@tauri-apps/api/core'
import { open as showOpenDialog } from '@tauri-apps/plugin-dialog'

import { getStoredPreference } from './preferences'
import { notifyFailure, pathAndReason } from './notify'
import type { DispatchLocal } from './save'

interface ProjectEntry {
  pathname: string
  name: string
  isFile: boolean
  isDirectory: boolean
  isMarkdown: boolean
  birthTime: number
  mtimeMs: number
}

/**
 * Prompt for a folder and announce it on `mt::open-directory` — the same event
 * the native Open Folder menu emits. The scan hangs off that event rather than
 * off this function so both entry points populate the tree the same way.
 */
export const askForOpenProject = async(dispatchLocal: DispatchLocal): Promise<void> => {
  const selected = await showOpenDialog({ directory: true })
  if (typeof selected !== 'string') return
  dispatchLocal('mt::open-directory', [selected])
}

/**
 * Replay a directory scan as tree events.
 *
 * `scan_project` returns parents before their children, which is what the tree
 * builder needs — `addFile` creates missing intermediate folders itself, but
 * emitting a child before its parent would leave the parent without the
 * metadata the sidebar sorts on.
 */
export const loadProjectTree = async(
  pathname: string,
  dispatchLocal: DispatchLocal
): Promise<void> => {
  // The tree honours the user's exclusion globs, and the scan and the watch
  // have to be told the same list or the watcher would add back what the scan
  // left out.
  const stored = await getStoredPreference('treePathExcludePatterns')
  const exclusions = Array.isArray(stored) ? stored.map(String) : []

  let entries: ProjectEntry[]
  try {
    entries = (await invoke('scan_project', { path: pathname, exclusions })) as ProjectEntry[]
  } catch (err) {
    console.error(`[tauri-bridge] cannot scan ${pathname}:`, err)
    // The user picked this folder in a dialog and is watching for a tree. A
    // directory that cannot be read — permissions, a network share that went
    // away — otherwise leaves the sidebar exactly as it was.
    notifyFailure(dispatchLocal, 'notifications.openFolderFailedTitle', pathAndReason(pathname, err))
    return
  }

  // Watch before replaying, so a file created during the replay is not missed.
  invoke('watch_project', { path: pathname, exclusions }).catch((err) =>
    console.warn(`[tauri-bridge] cannot watch ${pathname}:`, err)
  )

  for (const entry of entries) {
    if (entry.isDirectory) {
      dispatchLocal('mt::update-object-tree', [
        {
          type: 'addDir',
          change: {
            pathname: entry.pathname,
            name: entry.name,
            isCollapsed: true,
            isDirectory: true,
            isFile: false,
            isMarkdown: false,
            folders: [],
            files: []
          }
        }
      ])
    } else {
      // No `data` field: the watcher preloaded every file's markdown here, and
      // the tree threw it away again (treeCtrl.addFile strips it). Skipping the
      // read is what keeps opening a large folder cheap.
      dispatchLocal('mt::update-object-tree', [
        {
          type: 'add',
          change: {
            pathname: entry.pathname,
            name: entry.name,
            isFile: true,
            isDirectory: false,
            isMarkdown: entry.isMarkdown,
            birthTime: entry.birthTime,
            mtimeMs: entry.mtimeMs
          }
        }
      ])
    }
  }
}
