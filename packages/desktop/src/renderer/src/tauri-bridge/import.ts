// Importing a non-markdown document through pandoc, in place of the Electron
// main process's `openPandocFile` (src/main/menu/actions/file.ts).
//
// The converted markdown opens as an untitled tab rather than a document
// bound to the source file: writing markdown back over a .docx is not what
// saving should do, and that is how upstream behaved too.

import { invoke } from '@tauri-apps/api/core'
import { open as showOpenDialog } from '@tauri-apps/plugin-dialog'

import { t } from '@/i18n'
import type { DispatchLocal } from './save'

/** Formats pandoc is asked to read. Mirrors `PANDOC_EXTENSIONS` in main/config. */
export const PANDOC_EXTENSIONS = [
  'html',
  'docx',
  'odt',
  'latex',
  'tex',
  'ltx',
  'rst',
  'rest',
  'org',
  'wiki',
  'dokuwiki',
  'textile',
  'opml',
  'epub'
]

export const canImportWithPandoc = (path: string): boolean => {
  const lower = path.toLowerCase()
  return PANDOC_EXTENSIONS.some((ext) => lower.endsWith(`.${ext}`))
}

/**
 * Tell the user pandoc is needed. The renderer's notification store already
 * knows this channel and shows a confirm button pointing at the install page.
 */
const reportMissingPandoc = (dispatchLocal: DispatchLocal): void => {
  dispatchLocal('mt::pandoc-not-exists', [
    { title: t('dialog.importWarning'), message: t('dialog.installPandoc') }
  ])
}

/** Convert `path` and open the result, or explain why it could not be done. */
export const importWithPandoc = async(
  path: string,
  dispatchLocal: DispatchLocal
): Promise<void> => {
  if (!path) return

  if (!(await invoke('command_exists', { name: 'pandoc' }))) {
    reportMissingPandoc(dispatchLocal)
    return
  }

  let markdown: unknown
  try {
    markdown = await invoke('pandoc_to_markdown', { path })
  } catch (err) {
    console.error(`[tauri-bridge] cannot import ${path}:`, err)
    return
  }
  if (typeof markdown !== 'string') return

  // No pathname: the tab is new content, not a view onto the imported file.
  dispatchLocal('mt::open-new-tab', [{ markdown }, {}, true])
}

/** Prompt for a document to import. */
export const askForImportFile = async(dispatchLocal: DispatchLocal): Promise<void> => {
  const selected = await showOpenDialog({
    filters: [{ name: 'Documents', extensions: PANDOC_EXTENSIONS }]
  })
  if (typeof selected !== 'string') return
  await importWithPandoc(selected, dispatchLocal)
}
