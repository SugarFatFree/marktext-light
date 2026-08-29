// Reloading a document that changed on disk, in place of the Electron main
// process's per-file chokidar watch (`WatchType.file` in
// src/main/filesystem/watcher.ts).
//
// The Rust side reports only that a path changed; the document is built here,
// where opening a file already builds one. Duplicating that in Rust would mean
// two implementations of the same thing, free to drift.

import { invoke } from '@tauri-apps/api/core'
import pathe from 'pathe'

import type { DispatchLocal } from './save'

/** Paths behind open tabs. The Rust watch is re-armed whenever this changes. */
const openPaths = new Set<string>()

let syncTimer: ReturnType<typeof setTimeout> | null = null

// Opening a folder of documents adds paths one at a time; re-arming the watch
// for each would ask Rust to rebuild the whole set repeatedly.
const SYNC_DELAY = 200

const syncWatch = (): void => {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    invoke('watch_open_files', { paths: [...openPaths] }).catch((err) =>
      console.warn('[tauri-bridge] cannot watch open files:', err)
    )
  }, SYNC_DELAY)
}

export const trackOpenFile = (pathname: string | null | undefined): void => {
  if (!pathname || openPaths.has(pathname)) return
  openPaths.add(pathname)
  syncWatch()
}

export const untrackOpenFile = (pathname: string | null | undefined): void => {
  if (!pathname || !openPaths.delete(pathname)) return
  syncWatch()
}

interface DiskChange {
  pathname: string
  kind: 'change' | 'unlink'
}

/**
 * Turn a disk-change signal into the `mt::update-file` payload the editor
 * store expects.
 *
 * The store compares the incoming markdown against the tab's own before it
 * warns, so a save the editor itself performed — or a checkout that left the
 * bytes identical — passes through without bothering anyone. That comparison
 * needs the content, which is why the file is read here rather than merely
 * announced.
 */
export const handleDiskChange = async(
  payload: unknown,
  dispatchLocal: DispatchLocal
): Promise<void> => {
  const { pathname, kind } = (payload ?? {}) as Partial<DiskChange>
  if (!pathname || !openPaths.has(pathname)) return

  if (kind === 'unlink') {
    dispatchLocal('mt::update-file', [{ type: 'unlink', change: { pathname } }])
    return
  }

  let markdown: unknown
  try {
    markdown = await invoke('read_file', { path: pathname, encoding: 'utf8' })
  } catch {
    // Removed between the event and the read; the unlink event is on its way.
    return
  }
  if (typeof markdown !== 'string') return

  dispatchLocal('mt::update-file', [
    {
      type: 'change',
      change: {
        pathname,
        data: { markdown, filename: pathe.basename(pathname), pathname }
      }
    }
  ])
}
