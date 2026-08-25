// Tabs are not restored across launches; the left drawer's recent-files list
// is what survives instead.
//
// Nothing declares that — it falls out of the buffered-state snapshot being
// dropped rather than persisted. That makes it exactly the kind of behaviour a
// later "let's wire up the remaining channel" would undo without noticing, so
// assert the mechanism: the snapshot leaves the renderer and goes nowhere, and
// no reply ever arrives to restore from.

import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const BRIDGE = resolve(__dirname, '../../../src/renderer/src/tauri-bridge')
const source = (file: string): string => readFileSync(resolve(BRIDGE, file), 'utf-8')

describe('tab restoration', () => {
  it('drops the buffered-state snapshot instead of storing it', () => {
    const index = source('index.ts')

    // The channel has to be named as ignored on purpose. Reaching the generic
    // unhandled-channel branch would work by accident and warn on every edit.
    expect(index).toMatch(/IGNORED_INVOKES[\s\S]*?'update-buffer-state'/)
  })

  it('never sends the state back for restoring', () => {
    const files = ['index.ts', 'save.ts', 'preferences.ts', 'window.ts', 'project.ts']
    const dispatchesRestore = files.filter((file) => source(file).includes('mt::load-state'))

    expect(dispatchesRestore).toEqual([])
  })

  it('keeps the recent-files list out of that mechanism entirely', async() => {
    // Recent files live in localStorage, so they are unaffected by whatever
    // happens to the buffered state.
    vi.resetModules()
    localStorage.clear()
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())

    const { useRecentFilesStore } = await import('../../../src/renderer/src/store/recentFiles')
    useRecentFilesStore().ADD_RECENT_FILE('/docs/survives.md')

    expect(localStorage.getItem('recent-files')).toContain('/docs/survives.md')
  })
})
