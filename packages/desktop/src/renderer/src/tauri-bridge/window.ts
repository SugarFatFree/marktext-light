// Window close, in place of the Electron main process's close handling
// (src/main/app/windowManager.ts + the `mt::close-window-confirm` branch of
// src/main/menu/actions/file.ts).
//
// Electron let the main process veto a close and ask the renderer first. Tauri
// exposes the same veto to JS through `onCloseRequested`, so the whole
// handshake lives here: intercept the close, ask the renderer over
// `mt::ask-for-close`, and let it come back with `mt::close-window` (nothing
// unsaved) or `mt::close-window-confirm` (a list of documents to deal with).

import { getCurrentWindow } from '@tauri-apps/api/window'

import {
  askAboutUnsavedFiles,
  saveDocument,
  type DispatchLocal,
  type UnsavedFile
} from './save'

// Set once the renderer has agreed to close, so the second pass through
// `onCloseRequested` is allowed through instead of asking again.
let closeConfirmed = false

/**
 * Only the editor answers `mt::ask-for-close` — it is the editor store that
 * collects unsaved tabs and replies. Guarding any other window would veto its
 * close and wait for an answer that never comes, so the settings window closes
 * the ordinary way.
 */
export const installCloseGuard = (dispatchLocal: DispatchLocal, windowType: string): void => {
  if (windowType !== 'editor') return

  getCurrentWindow()
    .onCloseRequested((event) => {
      if (closeConfirmed) return
      event.preventDefault()
      dispatchLocal('mt::ask-for-close', [])
    })
    .catch((err) => console.warn('[tauri-bridge] cannot guard window close:', err))
}

export const closeWindow = async(): Promise<void> => {
  closeConfirmed = true
  await getCurrentWindow().destroy()
}

/**
 * Close with unsaved documents on the table.
 *
 * Diverges from Electron on one point: if a save fails or its dialog is
 * dismissed, the window stays open. Upstream closed anyway, which discards the
 * very edits the user just chose to keep — and the tab has already been told
 * about the failure over `mt::tab-save-failure`, so there is something to act on.
 */
export const closeWindowConfirm = async(
  files: UnsavedFile[],
  dispatchLocal: DispatchLocal
): Promise<void> => {
  const choice = await askAboutUnsavedFiles(files)
  if (choice === 'cancel') return

  if (choice === 'save') {
    const written = await Promise.all(files.map((file) => saveDocument(file, dispatchLocal)))
    if (written.some((path) => path === null)) return
  }

  await closeWindow()
}
