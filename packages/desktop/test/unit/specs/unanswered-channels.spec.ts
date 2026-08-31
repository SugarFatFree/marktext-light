// A channel the renderer waits on that nothing ever sends.
//
// The renderer is shared: it was written against an Electron main process, and
// the Tauri bridge re-creates the channels it can. Whatever is left over is a
// listener that will never fire. That is fine when the feature is absent from
// the UI too — nobody asks for a screenshot from a menu that has no screenshot
// entry — and it is a bug when a button, a menu item or a palette entry leads to
// it, because the click does nothing and says nothing.
//
// The keybindings page was the expensive version of this: it destructured a
// reply that never came, threw into a `.catch` that only logged, and came up as
// an empty table with two dead buttons. This test is the sweep that found it,
// kept, so the next one costs nothing to find.
//
// Every entry below is a claim that the feature is absent rather than broken,
// and the reason has to say where it is absent from.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'

const DESKTOP = resolve(__dirname, '../../..')
const RENDERER = join(DESKTOP, 'src/renderer')
const BRIDGE = join(RENDERER, 'src/tauri-bridge')
const RUST = join(DESKTOP, 'src-tauri/src')

const NOTHING_SENDS_THESE: Record<string, string> = {
  'mt::UPDATE_AVAILABLE': 'Auto-update is absent: boot info reports is_updatable false, the palette entry is gated on it, and no menu offers it.',
  'mt::UPDATE_NOT_AVAILABLE': 'Auto-update is absent; nothing in any menu or palette reaches it.',
  'mt::UPDATE_DOWNLOADED': 'Auto-update is absent; nothing in any menu or palette reaches it.',
  'mt::UPDATE_ERROR': 'Auto-update is absent; nothing in any menu or palette reaches it.',
  'mt::load-state': 'Tabs are deliberately not restored across launches; no-tab-restore.spec asserts both halves.',
  'mt::screenshot-captured': 'Screenshot is not implemented, and the palette entry that would have reached it is gated off.',
  'mt::bootstrap-editor': 'There is no main process to push it; the Tauri path bootstraps from boot info (store/editor.ts).',
  'mt::cm-copy-as-rich': 'The renderer draws its own context menu and emits on the bus directly (contextMenu/editor).',
  'mt::cm-copy-as-html': 'The renderer draws its own context menu and emits on the bus directly (contextMenu/editor).',
  'mt::cm-paste-as-plain-text': 'The renderer draws its own context menu and emits on the bus directly (contextMenu/editor).',
  'mt::cm-insert-paragraph': 'The renderer draws its own context menu and emits on the bus directly (contextMenu/editor).',
  'mt::spelling-replace-misspelling': 'The spelling section was not carried into the renderer context menu; see its header comment.',
  'mt::spelling-show-switch-language': 'The spelling section was not carried into the renderer context menu; see its header comment.',
  'mt::show-export-dialog': 'Export runs through the command centre, which emits `showExportDialog` on the bus.',
  'mt::switch-tab-by-file_path': 'Electron sent this to move focus between windows. There is one window here, and opening a file already open selects its tab.',
  'mt::window-zoom': 'Dispatched on the bus by app.vue, which the same action also listens for.'
}

const sources = (dir: string, acc: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sources(full, acc)
    else if (/\.(ts|vue|js|rs)$/.test(name)) acc.push(full)
  }
  return acc
}

const readAll = (dir: string): string =>
  sources(dir).map((f) => readFileSync(f, 'utf-8')).join('\n')

/** Channels the renderer subscribes to, excluding the bridge's own plumbing. */
const listened = (): Map<string, string> => {
  const found = new Map<string, string>()

  for (const file of sources(join(RENDERER, 'src'))) {
    if (file.startsWith(BRIDGE)) continue
    const lines = readFileSync(file, 'utf-8').split('\n')
    lines.forEach((line, i) => {
      const match = /ipcRenderer\.(?:on|once)\(\s*['"]([^'"]+)['"]/.exec(line)
      if (match) found.set(match[1] as string, `${relative(DESKTOP, file)}:${i + 1}`)
    })
  }

  return found
}

describe('channels the renderer waits on', () => {
  const emitters = `${readAll(BRIDGE)}\n${readAll(RUST)}`
  const subscribed = listened()

  it('finds the subscriptions at all', () => {
    expect(subscribed.size).toBeGreaterThan(30)
  })

  it('are either sent by something or listed with a reason', () => {
    const silent = [...subscribed]
      .filter(([channel]) => !emitters.includes(`'${channel}'`) && !emitters.includes(`"${channel}"`))
      .filter(([channel]) => !NOTHING_SENDS_THESE[channel])
      .map(([channel, site]) => `${channel}  (${site})`)

    expect(
      silent,
      'nothing sends these — send them, or add a line to NOTHING_SENDS_THESE saying where the feature is absent from'
    ).toEqual([])
  })

  it('has no entry for a channel that is now sent, or no longer listened for', () => {
    const stale = Object.keys(NOTHING_SENDS_THESE).filter(
      (channel) =>
        !subscribed.has(channel) ||
        emitters.includes(`'${channel}'`) ||
        emitters.includes(`"${channel}"`)
    )

    // An exemption outliving its reason is how the next dead channel gets in.
    expect(stale, 'remove these from NOTHING_SENDS_THESE').toEqual([])
  })

  it('gives a reason for every one of them', () => {
    const empty = Object.entries(NOTHING_SENDS_THESE)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([channel]) => channel)

    expect(empty, 'a reason has to say where the feature is absent from').toEqual([])
  })
})
