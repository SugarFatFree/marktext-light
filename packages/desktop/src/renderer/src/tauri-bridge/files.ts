// Renaming the file behind an open tab, in place of the Electron main
// process's `mt::rename` handler (src/main/menu/actions/file.ts).
//
// `mt::fs-trash-item` needs no code here: it is a plain request/response and
// goes through the invoke routing table in ./index.ts.

import { invoke } from '@tauri-apps/api/core'
import { ask } from '@tauri-apps/plugin-dialog'
import pathe from 'pathe'

import { t } from '@/i18n'
import type { DispatchLocal } from './save'

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

  dispatchLocal('mt::set-pathname', [
    { id, pathname: newPathname, filename: pathe.basename(newPathname) }
  ])
}
