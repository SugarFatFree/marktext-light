// Every path that reads the document must flush the engine's frame batch first.
//
// The engine queues edits and applies them on the next animation frame, so
// `getMarkdown()` / `getTOC()` / a tab's `markdown` all lag the last keystroke
// until that frame lands — and frames are not delivered to a hidden or occluded
// window at all. A read that skips the flush produces a document missing the
// most recent edit, which is then written to disk, exported, or used to decide
// that a tab has nothing worth prompting about.
//
// `flush()` exists for this (#2938, tab switching; #3803, saving). The checks
// below are on source text rather than behaviour: the engine-level guarantee is
// already covered by muya's own `flushPendingOps` spec, and what keeps breaking
// is a new read site that forgets to call it. Nothing here can prove a *new*
// read site flushes — only that these ones still do.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const read = (relative: string): string =>
  readFileSync(resolve(__dirname, '../../../src/renderer/src', relative), 'utf-8')

/** Index of `needle` in `haystack`, failing the test if it is absent. */
const at = (haystack: string, needle: string | RegExp): number => {
  const index = typeof needle === 'string' ? haystack.indexOf(needle) : haystack.search(needle)
  expect(index, `expected to find ${needle} in the source`).toBeGreaterThan(-1)
  return index
}

describe('reads of the document', () => {
  const editor = read('components/editorWithTabs/editor.vue')
  const store = read('store/editor.ts')

  it('flush when source mode takes over the document', () => {
    // Source mode is seeded from the markdown the store last received and
    // writes its own content back on exit, so an unflushed edit is first
    // missed and then overwritten.
    const watcher = at(editor, 'watch(sourceCode, (isSource) => {')
    const flush = editor.indexOf('editor.value?.flush()', watcher)
    const menus = editor.indexOf('mt::set-editor-format-menus-enabled', watcher)

    expect(flush).toBeGreaterThan(-1)
    expect(flush).toBeLessThan(menus)
  })

  it('flush before exporting', () => {
    const start = at(editor, 'const handleExport = async (options: unknown) => {')
    const flush = editor.indexOf('editor.value.flush()', start)
    const getMarkdown = editor.indexOf('editor.value.getMarkdown()', start)

    expect(flush).toBeGreaterThan(-1)
    expect(flush, 'the export would write a document short one keystroke').toBeLessThan(getMarkdown)
  })

  it('flush before deciding a window has nothing unsaved', () => {
    // The worst of the three: if the queued edit is the tab's only one,
    // `isSaved` is still true, so the window closes without ever asking.
    const start = at(store, "on('mt::ask-for-close'")
    const flush = store.indexOf('this.flushActiveEditor()', start)
    const snapshot = store.indexOf('sendBufferedState()', start)

    expect(flush).toBeGreaterThan(-1)
    expect(flush, 'the close prompt would never appear').toBeLessThan(snapshot)
  })

  it('still flush on the paths that already had to learn this', () => {
    for (const action of ['FILE_SAVE(', 'FILE_SAVE_AS(', 'MOVE_FILE_TO(']) {
      const start = at(store, action)
      const flush = store.indexOf('this.flushActiveEditor()', start)
      expect(flush, `${action} stopped flushing`).toBeGreaterThan(-1)
      expect(flush - start, `${action} flushes somewhere else entirely`).toBeLessThan(400)
    }
  })
})
