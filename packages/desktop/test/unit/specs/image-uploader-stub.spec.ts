// The image uploader has no implementation here, and has to say so.
//
// Electron ran the configured uploader (GitHub, SM.MS, a CLI script) in the main
// process and returned a URL. The Tauri bridge has no such thing, and the stub
// used to resolve with `{}`. `editor.vue` takes whatever comes back as the
// image's path, so an empty object was written into the document — and then to
// disk — as `[object Object]`, with no warning anywhere.
//
// A rejection reaches the `catch` in `editor.vue` that exists for this case: it
// shows the "Upload Image" warning and saves the image beside the document
// instead. So the requirement is not "the uploader works", which it does not,
// but "the uploader fails in the way the caller already handles".

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const source = (relative: string): string =>
  readFileSync(resolve(__dirname, '../../../src/renderer/src', relative), 'utf-8')

describe('the image uploader stub', () => {
  it('rejects instead of resolving with a value the caller would insert', () => {
    const bridge = source('tauri-bridge/index.ts')
    const stub = bridge.slice(bridge.indexOf('uploader: {'), bridge.indexOf('fonts: {'))

    expect(stub, 'the stub must throw').toMatch(/throw /)
    // The shape that caused the bug: an async function whose body is a value.
    expect(stub, 'resolving with an object is what wrote [object Object]').not.toMatch(
      /uploadImage:\s*async\(\)\s*=>\s*\(\{/
    )
  })

  it('fails with a translated message, since the caller shows it to the user', () => {
    const bridge = source('tauri-bridge/index.ts')

    expect(bridge).toContain("t('notifications.imageUploaderUnavailable')")
  })

  it('still has the fallback the rejection is meant to reach', () => {
    // If this ever stops catching, the rejection becomes an unhandled one and
    // pasting an image does nothing at all — worse than the bug it replaced.
    const editor = source('components/editorWithTabs/editor.vue')
    const uploadBranch = editor.slice(
      editor.indexOf("case 'upload':"),
      editor.indexOf("case 'folder':")
    )

    expect(uploadBranch).toContain('catch')
    expect(uploadBranch).toContain('moveImageToFolder')
  })
})
