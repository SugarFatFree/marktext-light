// The file drawer is open when the app starts.
//
// Under Electron the main process decides, from `restoreLayoutState` and the
// stored `sideBarVisibility`. There is no main process in the shipping build,
// so the renderer bootstraps itself, and that path has to state it — the layout
// store's own default for `showSideBar` is `false`.
//
// This matters more here than it would upstream: tabs are deliberately not
// restored, so the recent-files list in that drawer is the only navigation that
// survives a restart. A collapsed drawer on launch would leave a returning user
// with a blank window and no visible way back to their files.
//
// A source check, because the property lives in a Pinia action whose module
// graph reaches the bridge and i18n; asserting it behaviourally would mean
// standing all of that up to read one boolean. Both ends of the chain are
// pinned, so a change to either is caught.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const STORE = resolve(__dirname, '../../../src/renderer/src/store/editor.ts')

describe('the file drawer on launch', () => {
  const source = readFileSync(STORE, 'utf-8')

  /** The `isTauri()` self-bootstrap block, which is the shipping path. */
  const selfBootstrap = (): string => {
    const start = source.indexOf('if (isTauri()) {')
    expect(start, 'the Tauri self-bootstrap moved').toBeGreaterThan(-1)
    const end = source.indexOf('initThemeController', start)

    return source.slice(start, end)
  }

  it('is asked for by the self-bootstrap', () => {
    expect(selfBootstrap()).toMatch(/sideBarVisibility:\s*true/)
  })

  it('reaches the layout store from there', () => {
    // `bootstrapEditor` is the only consumer of that flag, and this is the
    // assignment that turns it into the visible drawer.
    expect(source).toMatch(/showSideBar:\s*!!sideBarVisibility/)
  })

  it('is not merely the store default, which is closed', () => {
    // Stated so the two tests above cannot be dismissed as redundant: without
    // the bootstrap saying so, the drawer starts collapsed.
    const layout = readFileSync(
      resolve(__dirname, '../../../src/renderer/src/store/layout.ts'),
      'utf-8'
    )

    expect(layout).toMatch(/const showSideBar = ref\(false\)/)
  })
})
