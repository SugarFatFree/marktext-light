// What every keystroke pays.
//
// The engine emits `json-change` on each edit, and the handler in editor.vue
// runs once per emit. Anything in there that touches the whole document is paid
// per keystroke, and in a large file that is what the user feels.
//
// `blocks: editor.value.getState()` was one of those: a deep clone of the
// entire document, stored on the tab, read by nothing — not by the editor, not
// by the store, not by the buffered state that gets persisted. It is gone, and
// this keeps it gone.
//
// A source check, because the cost is a call site rather than a behaviour: the
// value was never read, so no assertion about the app's output could have
// noticed it either way.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const RENDERER = resolve(__dirname, '../../../src/renderer/src')

const handler = (): string => {
  const source = readFileSync(
    resolve(RENDERER, 'components/editorWithTabs/editor.vue'),
    'utf-8'
  )
  const start = source.indexOf("editor.value.on('json-change'")
  expect(start, 'the json-change handler moved').toBeGreaterThan(-1)
  const end = source.indexOf('\n  })', start)

  return source.slice(start, end)
}

describe('the json-change handler', () => {
  it('does not clone the whole document', () => {
    // `getState()` deep-clones every block. Nothing downstream read the result.
    expect(handler()).not.toMatch(/getState\(\)/)
  })

  it('does not carry a blocks payload the tab never reads', () => {
    const store = readFileSync(resolve(RENDERER, 'store/editor.ts'), 'utf-8')

    expect(handler()).not.toMatch(/\bblocks\s*:/)
    expect(store).not.toMatch(/tab\.blocks\s*=/)
  })

  it('still reports what the tab actually uses', () => {
    // Removing dead work should not have removed live work: the markdown drives
    // save state, and the word count and TOC are on screen.
    const body = handler()
    expect(body).toMatch(/markdown/)
    expect(body).toMatch(/wordCount/)
    expect(body).toMatch(/toc/)
  })
})
