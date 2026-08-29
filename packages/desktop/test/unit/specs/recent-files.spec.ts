// The left drawer's recent-files list.
//
// This is the only navigation that survives a restart — tabs are deliberately
// not restored — so the guarantees it makes are worth pinning: entries persist,
// reopening moves a document back to the top rather than duplicating it, and
// nothing leaves the list except by the user's hand or the size cap.

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRecentFilesStore } from '../../../src/renderer/src/store/recentFiles'

const STORAGE_KEY = 'recent-files'

const storedPaths = (): string[] =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').map(
    (entry: { pathname: string }) => entry.pathname
  )

describe('recent files', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('records an opened document, newest first', () => {
    const store = useRecentFilesStore()

    store.ADD_RECENT_FILE('/docs/first.md')
    store.ADD_RECENT_FILE('/docs/second.md')

    expect(store.recentFiles.map((f) => f.pathname)).toEqual(['/docs/second.md', '/docs/first.md'])
    expect(store.recentFiles[0].filename).toBe('second.md')
  })

  it('moves a reopened document back to the top instead of duplicating it', () => {
    const store = useRecentFilesStore()

    store.ADD_RECENT_FILE('/docs/a.md')
    store.ADD_RECENT_FILE('/docs/b.md')
    store.ADD_RECENT_FILE('/docs/a.md')

    expect(store.recentFiles.map((f) => f.pathname)).toEqual(['/docs/a.md', '/docs/b.md'])
  })

  it('survives a restart', () => {
    useRecentFilesStore().ADD_RECENT_FILE('/docs/kept.md')

    // A fresh pinia is what a new window gets; the list has to come back off
    // storage rather than out of the previous instance.
    setActivePinia(createPinia())

    expect(useRecentFilesStore().recentFiles.map((f) => f.pathname)).toEqual(['/docs/kept.md'])
  })

  it('only forgets a document when told to', () => {
    const store = useRecentFilesStore()
    store.ADD_RECENT_FILE('/docs/keep.md')
    store.ADD_RECENT_FILE('/docs/drop.md')

    store.REMOVE_RECENT_FILE('/docs/drop.md')

    expect(store.recentFiles.map((f) => f.pathname)).toEqual(['/docs/keep.md'])
    expect(storedPaths()).toEqual(['/docs/keep.md'])
  })

  it('clears the whole list on request', () => {
    const store = useRecentFilesStore()
    store.ADD_RECENT_FILE('/docs/a.md')
    store.ADD_RECENT_FILE('/docs/b.md')

    store.CLEAR_RECENT_FILES()

    expect(store.recentFiles).toEqual([])
    expect(storedPaths()).toEqual([])
  })

  it('caps the list, dropping the least recently opened', () => {
    const store = useRecentFilesStore()
    for (let i = 0; i < 55; i++) store.ADD_RECENT_FILE(`/docs/file-${i}.md`)

    expect(store.recentFiles).toHaveLength(50)
    expect(store.recentFiles[0].pathname).toBe('/docs/file-54.md')
    expect(store.recentFiles.at(-1)!.pathname).toBe('/docs/file-5.md')
  })

  it('ignores a blank path rather than storing an empty entry', () => {
    const store = useRecentFilesStore()

    store.ADD_RECENT_FILE('')
    store.ADD_RECENT_FILE(null)
    store.ADD_RECENT_FILE(undefined)

    expect(store.recentFiles).toEqual([])
  })

  it('starts empty when storage holds something unreadable', () => {
    localStorage.setItem(STORAGE_KEY, 'not json at all')

    expect(useRecentFilesStore().recentFiles).toEqual([])
  })
})
