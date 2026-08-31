// Export and print, in place of the Electron main process's
// `mt::response-export` / `mt::response-print` handlers
// (src/main/menu/actions/file.ts).
//
// HTML export is a straight save-dialog-then-write. PDF is not: Electron
// captured the page with `webContents.printToPDF`, and Tauri exposes nothing
// equivalent. The WebView's own print dialog does offer "Save as PDF" on all
// three platforms, and by the time this runs the renderer has already swapped
// in its print-service DOM — the very layout `printToPDF` used to capture — so
// printing produces the same document, with the destination chosen in the
// system dialog instead of ours.
//
// The visible difference: no `mt::export-success` for PDF, because the path the
// user picked in the system dialog is not reported back to us.

import { invoke } from '@tauri-apps/api/core'
import { save as showSaveDialog } from '@tauri-apps/plugin-dialog'
import pathe from 'pathe'

import { t } from '@/i18n'
import type { DispatchLocal } from './save'

export interface ExportPayload {
  type: 'styledHtml' | 'pdf'
  title?: string
  content?: string
  filename?: string
  pathname?: string
}

/**
 * Say so. Electron raised `mt::show-notification` from the main process when an
 * export failed; this file only wrote to the console, so a save into a folder
 * that had gone read-only, or onto a full disk, looked exactly like a successful
 * export — the dialog closed and nothing else happened. The same silence on the
 * open path is what `notifyUnreadable` was added for.
 */
const notifyExportFailed = (dispatchLocal: DispatchLocal, message: string): void => {
  dispatchLocal('mt::show-notification', [
    { title: t('notifications.exportFailedTitle'), type: 'error', message }
  ])
}

const EXTENSION: Record<string, string> = {
  styledHtml: '.html',
  pdf: '.pdf'
}

/**
 * Hand the page to the WebView's print dialog, then restore the editor.
 *
 * The clear-up must happen whatever the user chose: `window.print()` blocks
 * until the dialog closes, and leaving the print-service DOM in place would
 * strand the editor showing a print layout.
 */
const printThenRestore = (dispatchLocal: DispatchLocal): void => {
  try {
    window.print()
  } catch (err) {
    console.error('[tauri-bridge] cannot open the print dialog:', err)
  } finally {
    dispatchLocal('mt::print-service-clearup', [])
  }
}

export const exportDocument = async(
  payload: ExportPayload,
  dispatchLocal: DispatchLocal
): Promise<void> => {
  const { type, content, pathname, title } = payload ?? {}
  const extension = EXTENSION[type]
  if (!extension) {
    console.warn(`[tauri-bridge] unknown export type: ${type}`)
    return
  }

  if (type === 'pdf') {
    printThenRestore(dispatchLocal)
    return
  }

  if (!content) {
    console.error('[tauri-bridge] nothing to export: no HTML content')
    notifyExportFailed(dispatchLocal, t('notifications.exportNoContentMessage'))
    return
  }

  const base = pathname ? pathe.basename(pathname, '.md') : title || 'Untitled'
  const name = `${base}${extension}`
  const defaultPath = pathname ? pathe.join(pathe.dirname(pathname), name) : name

  const filePath = await showSaveDialog({
    defaultPath,
    filters: [{ name: 'HTML', extensions: ['html'] }]
  })
  if (!filePath) return

  try {
    await invoke('write_file', { path: filePath, data: content })
  } catch (err) {
    console.error('[tauri-bridge] error while exporting:', err)
    notifyExportFailed(
      dispatchLocal,
      t('notifications.exportFailedMessage', {
        path: filePath,
        msg: err instanceof Error ? err.message : String(err)
      })
    )
    return
  }

  dispatchLocal('mt::export-success', [{ type, filePath }])
}

export const printDocument = (dispatchLocal: DispatchLocal): void => {
  printThenRestore(dispatchLocal)
}
