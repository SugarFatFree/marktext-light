// The drawer's single file list.
//
// "Opened files" and "recent files" used to be two sections, which meant an
// open file appeared twice and the same click did different things depending
// on which copy you hit. Merging them has edge cases that are easy to get
// wrong and invisible until someone hits them, so the merge is a plain
// function and they are all here.

import { describe, it, expect } from 'vitest'
import { mergeFileEntries } from '@/components/sideBar/mergeFileEntries'
import type { TabDescriptor } from '@/components/sideBar/types'

const tab = (id: string, filename: string, pathname = ''): TabDescriptor =>
  ({ id, filename, pathname, isSaved: true }) as TabDescriptor

const recent = (pathname: string) => ({
  pathname,
  filename: pathname.split('/').pop() as string
})

describe('mergeFileEntries', () => {
  it('marks a recent file that is currently open', () => {
    const entries = mergeFileEntries([tab('1', 'a.md', '/tmp/a.md')], [recent('/tmp/a.md')], true)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.tab?.id).toBe('1')
  })

  it('lists a recent file that is not open, unmarked', () => {
    const entries = mergeFileEntries([], [recent('/tmp/a.md')], true)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.tab).toBeNull()
  })

  it('never lists the same path twice', () => {
    // The whole point of the merge: one row per file, whatever its state.
    const entries = mergeFileEntries(
      [tab('1', 'a.md', '/tmp/a.md')],
      [recent('/tmp/a.md'), recent('/tmp/b.md')],
      true
    )

    expect(entries.map((e) => e.pathname)).toEqual(['/tmp/a.md', '/tmp/b.md'])
  })

  it('keeps the recent list in its own order', () => {
    const entries = mergeFileEntries([], [recent('/tmp/b.md'), recent('/tmp/a.md')], true)

    expect(entries.map((e) => e.pathname)).toEqual(['/tmp/b.md', '/tmp/a.md'])
  })

  it('shows untitled documents, which no recent list can hold', () => {
    const entries = mergeFileEntries([tab('1', 'Untitled')], [recent('/tmp/a.md')], true)

    expect(entries.map((e) => e.filename)).toEqual(['Untitled', 'a.md'])
    expect(entries[0]?.tab?.id).toBe('1')
  })

  it('keeps open documents listed after the recent list is cleared', () => {
    // Otherwise "clear recent" empties the drawer while documents sit open in
    // it — the rows for open files come from that list.
    const entries = mergeFileEntries([tab('1', 'a.md', '/tmp/a.md')], [], true)

    expect(entries).toHaveLength(1)
    expect(entries[0]?.pathname).toBe('/tmp/a.md')
    expect(entries[0]?.tab?.id).toBe('1')
  })

  it('drops open documents entirely when the preference is off', () => {
    // "Show opened files", turned off: recent files alone, no marks.
    const entries = mergeFileEntries(
      [tab('1', 'a.md', '/tmp/a.md'), tab('2', 'Untitled')],
      [recent('/tmp/a.md')],
      false
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]?.tab).toBeNull()
  })

  it('gives every row a key that survives a re-render', () => {
    const entries = mergeFileEntries(
      [tab('1', 'Untitled'), tab('2', 'a.md', '/tmp/a.md')],
      [recent('/tmp/a.md'), recent('/tmp/b.md')],
      true
    )
    const keys = entries.map((e) => e.key)

    expect(new Set(keys).size).toBe(keys.length)
  })
})
