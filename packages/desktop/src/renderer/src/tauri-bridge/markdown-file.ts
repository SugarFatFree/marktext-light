// Loading a markdown document, in place of Electron's
// `main/filesystem/markdown.ts` → `loadMarkdownFile`.
//
// The bridge used to read documents with `read_file` and hand the renderer a
// bare string. That lost three things the tab state has fields for and the save
// path already reads:
//
//   - the encoding, so a GBK document is not silently rewritten as UTF-8 the
//     first time it is saved (`save.ts` refuses to, but only if it is told);
//   - whether the file carried a byte-order mark, which has to be stripped to
//     be read and written back to be preserved;
//   - the line ending, so a CRLF file does not come back from a save as LF.
//
// The decoding itself is in Rust (`commands/markdown.rs`), because a WebView
// has only `TextDecoder` and no way to guess an encoding.

import { invoke } from '@tauri-apps/api/core'

import { getStoredPreference } from './preferences'

/** What the Rust side returns; the shape `mt::open-new-tab` already expects. */
export interface LoadedMarkdown {
  markdown: string
  filename: string
  pathname: string
  encoding: { encoding: string, isBom: boolean }
  lineEnding: 'lf' | 'crlf'
  adjustLineEndingOnSave: boolean
  trimTrailingNewline: number
  isMixedLineEndings: boolean
}

/**
 * Mirrors `Preference.getPreferredEol`: the stored value wins, and `default`
 * means CRLF on Windows and LF everywhere else. Used only when the file itself
 * does not say — an empty file, or one with no line break in it.
 */
const preferredEol = async(platform: string): Promise<'lf' | 'crlf'> => {
  const stored = await getStoredPreference('endOfLine')
  if (stored === 'lf') return 'lf'
  if (stored === 'crlf') return 'crlf'
  return platform === 'win32' ? 'crlf' : 'lf'
}

/** Throws with the decoder's or the OS's message; callers surface it. */
export const loadMarkdownFile = async(
  pathname: string,
  platform: string
): Promise<LoadedMarkdown> => {
  const [eol, autoNormalize] = await Promise.all([
    preferredEol(platform),
    getStoredPreference('autoNormalizeLineEndings')
  ])

  return (await invoke('read_markdown_file', {
    path: pathname,
    preferredEol: eol,
    autoNormalizeLineEndings: !!autoNormalize
  })) as LoadedMarkdown
}
