// File dialogs that used to live in the Electron main process: renaming or
// moving the file behind an open tab, and picking an image
// (src/main/menu/actions/file.ts, src/main/dataCenter/index.ts).
//
// `mt::fs-trash-item` needs no code here: it is a plain request/response and
// goes through the invoke routing table in ./index.ts.

import { invoke } from '@tauri-apps/api/core'
import { ask, open as showOpenDialog, save as showSaveDialog } from '@tauri-apps/plugin-dialog'
import pathe from 'pathe'

import { t } from '@/i18n'
import { trackOpenFile, untrackOpenFile } from './open-files'
import type { DispatchLocal } from './save'

// Mirrors `common/filesystem/paths`, which cannot be imported here: that module
// pulls in Node's `fs`, and this bundle runs in a WebView. The bridge inlines
// its markdown list for the same reason.
const IMAGE_EXTENSIONS = ['jpeg', 'jpg', 'png', 'gif', 'svg', 'webp'] as const

interface RenamePayload {
  id: string
  pathname: string
  newPathname: string
}

/**
 * Rename the file behind an open tab, then tell the tab its new path.
 *
 * The sidebar's own rename goes straight through `fileUtils.move`; this is the
 * editor-side path, which additionally has to keep the tab in sync.
 */
export const renameOpenFile = async(
  payload: RenamePayload,
  dispatchLocal: DispatchLocal
): Promise<void> => {
  const { id, pathname, newPathname } = payload ?? {}
  if (!pathname || !newPathname || pathname === newPathname) return

  if (await invoke('path_exists', { path: newPathname })) {
    // Two buttons, matching what the Electron dialog offered. Default to
    // cancel: overwriting is the destructive answer.
    const replace = await ask(t('dialog.fileExists', { filename: pathe.basename(newPathname) }), {
      kind: 'warning',
      okLabel: t('dialog.replace'),
      cancelLabel: t('dialog.cancel')
    })
    if (!replace) return
  }

  try {
    await invoke('move_path', { src: pathname, dest: newPathname })
  } catch (err) {
    console.error(`[tauri-bridge] cannot rename ${pathname}:`, err)
    return
  }

  // The tab follows the file: watch where it went, and stop watching where it
  // was. Left tracked, the old path would keep a watch alive and report changes
  // for a tab that has moved on.
  untrackOpenFile(pathname)
  trackOpenFile(newPathname)
  dispatchLocal('mt::set-pathname', [
    { id, pathname: newPathname, filename: pathe.basename(newPathname) }
  ])
}

/**
 * Move the file behind an open tab somewhere else, then point the tab at it.
 *
 * A save dialog rather than a folder picker, because the move may rename: it is
 * the same gesture Electron offered under a "Move to" button label.
 */
export const moveOpenFileTo = async(
  payload: { id: string; pathname: string },
  dispatchLocal: DispatchLocal
): Promise<void> => {
  const { id, pathname } = payload ?? {}
  if (!pathname) return

  const destination = await showSaveDialog({ defaultPath: pathname })
  if (!destination || destination === pathname) return

  try {
    await invoke('move_path', { src: pathname, dest: destination })
  } catch (err) {
    console.error(`[tauri-bridge] cannot move ${pathname}:`, err)
    return
  }

  untrackOpenFile(pathname)
  trackOpenFile(destination)
  dispatchLocal('mt::set-pathname', [
    { id, pathname: destination, filename: pathe.basename(destination) }
  ])
}

/** Pick an image to insert. Resolves to '' when the dialog is dismissed. */
export const askForImagePath = async(): Promise<string> => {
  const selected = await showOpenDialog({
    filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }]
  })
  return typeof selected === 'string' ? selected : ''
}
