// The save chain, in place of the Electron main process's
// `mt::response-file-save` / `-save-as` / `mt::save-tabs` handlers
// (src/main/menu/actions/file.ts + src/main/filesystem/markdown.ts).
//
// The renderer fires these and then waits for `mt::set-pathname` /
// `mt::tab-saved` / `mt::tab-save-failure` to come back before it clears a
// tab's dirty flag, so this module has to close that loop or nothing ever
// reaches disk.

import { invoke } from '@tauri-apps/api/core'
import { save as showSaveDialog } from '@tauri-apps/plugin-dialog'
import pathe from 'pathe'

import bus from '@/bus'

export interface SaveEncoding {
  encoding?: string
  isBom?: boolean
}

export interface SaveOptions {
  encoding?: SaveEncoding
  lineEnding?: string
  adjustLineEndingOnSave?: boolean
  trimTrailingNewline?: number
}

export interface UnsavedFile {
  id: string
  filename: string
  pathname?: string
  markdown: string
  options?: SaveOptions
  defaultPath?: string
}

/** Emit a push event onto the bridge's local bus (index.ts owns the bus). */
export type DispatchLocal = (channel: string, args: unknown[]) => void

// Mirrors main/config.ts LINE_ENDING_REG.
const LINE_ENDING_REG = /(?:\r\n|\n)/g

const getLineEnding = (lineEnding?: string): string => {
  if (lineEnding === 'crlf') return '\r\n'
  if (lineEnding !== 'lf') {
    console.error(`[tauri-bridge] invalid end of line character: ${lineEnding}`)
  }
  return '\n'
}

/**
 * Mirrors `main/utils/index.ts` — the first-level heading becomes the suggested
 * filename in the save dialog.
 */
const getRecommendTitleFromMarkdownString = (markdown: string): string => {
  const tokens = markdown.match(/#{1,6} {1,}(.*\S.*)(?:\n|$)/g)
  if (!tokens) return ''
  const headers = tokens
    .map((token) => token.trim().match(/(#{1,6}) {1,}(.+)/))
    .filter((matches): matches is RegExpMatchArray => !!matches)
    .map((matches) => ({ level: matches[1].length, content: matches[2].trim() }))
  if (!headers.length) return ''
  return headers.sort((a, b) => a.level - b.level)[0].content
}

/**
 * Encode for disk. Electron used iconv-lite and could round-trip any legacy
 * encoding; a WebView only has `TextEncoder`, which is UTF-8 only. Rather than
 * silently rewriting a GBK/Latin-1 document as UTF-8, refuse it and let the
 * caller surface `mt::tab-save-failure` — re-encoding a file the user never
 * asked to convert is worse than not saving.
 */
const encodeMarkdown = (markdown: string, options: SaveOptions = {}): Uint8Array => {
  const { adjustLineEndingOnSave, lineEnding } = options
  const encoding = options.encoding?.encoding ?? 'utf8'
  const normalized = encoding.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (normalized !== 'utf8') {
    throw new Error(
      `Saving "${encoding}" documents is not supported yet; only UTF-8 can be written.`
    )
  }

  const content = adjustLineEndingOnSave
    ? markdown.replace(LINE_ENDING_REG, getLineEnding(lineEnding))
    : markdown
  return new TextEncoder().encode(options.encoding?.isBom ? `\ufeff${content}` : content)
}

const writeMarkdownFile = async(pathname: string, markdown: string, options?: SaveOptions) => {
  const bytes = encodeMarkdown(markdown, options)
  // `Array.from` because Tauri's IPC serializes a Uint8Array to `{"0":…}`,
  // which the Rust side's `Vec<u8>` cannot deserialize.
  await invoke('write_file', { path: pathname, data: Array.from(bytes) })
}

/** Append the document's extension when the chosen path has none, as upstream does. */
const withExtension = (filePath: string): string =>
  pathe.extname(filePath) ? filePath : `${filePath}.md`

const askForSavePath = async(file: UnsavedFile): Promise<string | null> => {
  const recommended =
    getRecommendTitleFromMarkdownString(file.markdown) || file.filename || 'Untitled'
  const name = `${recommended}.md`
  // A bare filename leaves the starting directory to the native dialog, which
  // is what we want when the window has no project folder open.
  const defaultPath = file.defaultPath ? pathe.join(file.defaultPath, name) : name
  const selected = await showSaveDialog({ defaultPath })
  return selected ? withExtension(selected) : null
}

/**
 * Save one document, then tell the renderer which of its two outcomes happened:
 * a brand-new file reports its path back (`mt::set-pathname`) so the tab adopts
 * it, an existing one just clears the dirty flag (`mt::tab-saved`).
 *
 * Resolves to the written path, or null when the user cancels the dialog or the
 * write fails — the caller uses that to decide whether a close may proceed.
 */
export const saveDocument = async(
  file: UnsavedFile,
  dispatchLocal: DispatchLocal,
  forceDialog = false
): Promise<string | null> => {
  const { id, pathname, markdown, options } = file
  const alreadyExistOnDisk = !!pathname && !forceDialog
  let filePath = alreadyExistOnDisk ? pathname : null

  if (!filePath) {
    filePath = await askForSavePath(file)
    // Dialog canceled by the user — not an error, and nothing to report.
    if (!filePath) return null
  }

  try {
    await writeMarkdownFile(filePath, markdown, options)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[tauri-bridge] error while saving:', err)
    dispatchLocal('mt::tab-save-failure', [id, msg])
    return null
  }

  if (alreadyExistOnDisk) {
    dispatchLocal('mt::tab-saved', [id])
  } else {
    dispatchLocal('mt::set-pathname', [
      { id, pathname: filePath, filename: pathe.basename(filePath) }
    ])
  }
  return filePath
}

// -----------------------------------------------------------------------------
// Closing tabs that still have unsaved changes
// -----------------------------------------------------------------------------

export type UnsavedFilesChoice = 'save' | 'dontSave' | 'cancel'

export interface UnsavedFilesRequest {
  files: UnsavedFile[]
  respond: (choice: UnsavedFilesChoice) => void
}

/** Bus event that `components/unsavedFilesDialog` answers. */
export const UNSAVED_FILES_ASK_EVENT = 'unsaved-files::ask'

/**
 * Electron used a native three-button message box here. A Tauri dialog only has
 * two, so the prompt lives in the renderer instead — which also keeps it
 * localized and themed like the rest of the UI.
 */
const askAboutUnsavedFiles = (files: UnsavedFile[]): Promise<UnsavedFilesChoice> =>
  new Promise((resolve) => {
    // No dialog mounted (a window still booting) — treat it as "cancel" rather
    // than leaving the caller, and the tab close, hanging forever.
    if (!bus.all.get(UNSAVED_FILES_ASK_EVENT)?.length) {
      console.warn('[tauri-bridge] no unsaved-files dialog mounted; cancelling close')
      resolve('cancel')
      return
    }
    const request: UnsavedFilesRequest = { files, respond: resolve }
    bus.emit(UNSAVED_FILES_ASK_EVENT, request)
  })

/**
 * Ask, then close only what the answer allows: everything on "don't save", the
 * documents that actually reached disk on "save", nothing on "cancel". The tabs
 * stay open until `mt::force-close-tabs-by-id` names them.
 */
export const saveAndCloseTabs = async(
  files: UnsavedFile[],
  dispatchLocal: DispatchLocal
): Promise<void> => {
  if (!files.length) return

  const choice = await askAboutUnsavedFiles(files)
  if (choice === 'cancel') return

  if (choice === 'dontSave') {
    dispatchLocal('mt::force-close-tabs-by-id', [files.map((file) => file.id)])
    return
  }

  const saved = await Promise.all(
    files.map((file) => saveDocument(file, dispatchLocal).then((path) => (path ? file.id : null)))
  )
  dispatchLocal('mt::force-close-tabs-by-id', [saved.filter((id): id is string => !!id)])
}
