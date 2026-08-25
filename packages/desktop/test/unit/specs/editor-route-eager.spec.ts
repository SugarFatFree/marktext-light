// The editor route must not be lazy.
//
// Electron's main process sends `mt::bootstrap-editor` from
// `webContents.once('did-finish-load')`, which fires once the page's static
// imports have loaded. Behind a dynamic import, `app.vue` mounts after that,
// registers its listener too late, and the message is gone — `init` never
// becomes true and the editor window stays blank for good.
//
// That regression shipped once and was only caught by the E2E suite, which
// takes a quarter of an hour and is cancelled by the next push. This says the
// same thing in the suite that runs in seconds.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROUTER = resolve(__dirname, '../../../src/renderer/src/router/index.ts')
const EDITOR_WINDOW = resolve(__dirname, '../../../src/main/windows/editor.ts')

describe('the editor route', () => {
  const source = readFileSync(ROUTER, 'utf-8')

  it('is imported statically', () => {
    expect(source).toMatch(/^import App from '@\/pages\/app\.vue'$/m)
    expect(source, 'a dynamic import would lose the bootstrap message').not.toMatch(
      /const App\s*=\s*\(\)\s*=>\s*import\(/
    )
  })

  it('still defers the settings tree', () => {
    // The other half of the split is the part that actually helps: a window
    // visits one tree or the other, never both.
    expect(source).toMatch(/const Preference\s*=\s*\(\)\s*=>\s*import\(/)
    expect(source).toMatch(/const Keybindings\s*=\s*\(\)\s*=>\s*import\(/)
  })

  it('is answering a one-shot message, which is why the timing matters', () => {
    // If the main process ever buffers this or resends it, the rule above can
    // be revisited. Until then it is a single shot at a listener that has to
    // already exist.
    const main = readFileSync(EDITOR_WINDOW, 'utf-8')

    expect(main).toMatch(/once\('did-finish-load'/)
    expect(main).toMatch(/mt::bootstrap-editor/)
  })
})
