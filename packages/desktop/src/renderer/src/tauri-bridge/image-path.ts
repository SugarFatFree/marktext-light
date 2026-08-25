// Image-path completion, in place of the Electron main process's
// `mt::ask-for-image-auto-path` handler
// (src/main/menu/actions/edit.ts + src/main/utils/imagePathAutoComplement.ts).
//
// Typing a path into the image tool offers the directories and images that
// match. The reply goes back on a per-request channel the caller subscribed to
// with `once`, so a stale response cannot resolve a newer request.
//
// The upstream implementation cached each directory's listing and watched it
// for changes; this reads the directory each time. A completion popup is
// keystroke-driven over one directory, so the cache mostly guarded against a
// cost that is not there — and a stale cache is how a just-added image fails
// to show up.

import { invoke } from '@tauri-apps/api/core'
import pathe from 'pathe'

import type { DispatchLocal } from './save'

interface DirEntry {
  file: string
  type: string
}

interface AutoPathRequest {
  id?: string
  src?: string
  pathname?: string
}

/** Windows' recycle bin shows up in directory listings and is never wanted. */
const BLACK_LIST = ['$RECYCLE.BIN']

export const askForImageAutoPath = async(
  request: unknown,
  dispatchLocal: DispatchLocal
): Promise<void> => {
  const { id, src, pathname } = (request ?? {}) as AutoPathRequest
  const channel = `mt::response-of-image-path-${id}`
  const reply = (entries: DirEntry[]): void => dispatchLocal(channel, [entries])

  if (!id) return
  if (!src || typeof src !== 'string' || !pathname) {
    reply([])
    return
  }

  const fullPath = pathe.isAbsolute(src) ? src : pathe.join(pathe.dirname(pathname), src)
  // A trailing separator means the user is inside that directory rather than
  // partway through naming something in its parent.
  const endsWithSeparator = /[/\\]$/.test(fullPath)
  const directory = endsWithSeparator ? fullPath.slice(0, -1) : pathe.dirname(fullPath)
  const searchKey = endsWithSeparator ? '' : pathe.basename(fullPath)

  let entries: DirEntry[]
  try {
    entries = (await invoke('readdir_kinds', { path: directory })) as DirEntry[]
  } catch {
    // Half-typed paths point at directories that do not exist yet; that is not
    // an error, just nothing to suggest.
    reply([])
    return
  }

  const candidates = entries.filter(
    (entry) =>
      !BLACK_LIST.includes(entry.file) &&
      (entry.type === 'directory' || entry.type === 'image')
  )

  if (!searchKey) {
    reply(candidates)
    return
  }

  // Loaded on demand: this is the only eager path that wanted fuzzaldrin, and
  // pulling a matcher into the startup bundle for a feature most sessions never
  // touch is exactly what the first-paint work was undoing.
  const { filter } = await import('fuzzaldrin')
  reply(filter(candidates, searchKey, { key: 'file' }))
}
