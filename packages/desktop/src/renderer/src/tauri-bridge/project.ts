// Opening a folder in the sidebar, in place of the Electron main process's
// folder dialog + chokidar watcher (src/main/filesystem/watcher.ts).
//
// The project store builds its tree from a stream of `mt::update-object-tree`
// events rather than one listing, so the scan is replayed as the same
// `addDir` / `add` events the watcher used to send. Once the scan is done a
// Rust watcher takes over and emits the same shapes for later changes.

import { invoke } from '@tauri-apps/api/core'
import { open as showOpenDialog } from '@tauri-apps/plugin-dialog'

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
  let entries: ProjectEntry[]
  try {
    entries = (await invoke('scan_project', { path: pathname })) as ProjectEntry[]
  } catch (err) {
    console.error(`[tauri-bridge] cannot scan ${pathname}:`, err)
    return
  }

  // Watch before replaying, so a file created during the replay is not missed.
  invoke('watch_project', { path: pathname }).catch((err) =>
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
