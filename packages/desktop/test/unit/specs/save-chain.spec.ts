// What actually reaches disk when a document is saved.
//
// Every case here is one where being wrong corrupts a file rather than failing:
// a line ending silently rewritten, a byte-order mark dropped or doubled, or a
// GBK document re-encoded as UTF-8 because the save path assumed everything was
// UTF-8 anyway.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const invoke = vi.fn()
const showSaveDialog = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('@tauri-apps/plugin-dialog', () => ({
  save: (...args: unknown[]) => showSaveDialog(...args)
}))

const UTF8 = { encoding: 'utf8', isBom: false }

const load = async() => {
  vi.resetModules()
  return import('../../../src/renderer/src/tauri-bridge/save')
}

/** The bytes handed to `write_file`, decoded back for readable assertions. */
const written = (): { path: string; bytes: number[] } => {
  const call = invoke.mock.calls.find(([command]) => command === 'write_file')
  if (!call) throw new Error('nothing was written')
  const { path, data } = call[1] as { path: string; data: number[] }
  return { path, bytes: data }
}

const asText = (bytes: number[]): string => new TextDecoder().decode(new Uint8Array(bytes))

describe('saving a document', () => {
  beforeEach(() => {
    invoke.mockReset()
    showSaveDialog.mockReset()
    invoke.mockResolvedValue(undefined)
  })

  it('writes an already-saved document straight back', async() => {
    const { saveDocument } = await load()
    const dispatch = vi.fn()

    const result = await saveDocument(
      {
        id: 't1',
        filename: 'notes.md',
        pathname: '/docs/notes.md',
        markdown: 'hello',
        options: { encoding: UTF8, lineEnding: 'lf' }
      },
      dispatch
    )

    expect(showSaveDialog, 'an existing path needs no dialog').not.toHaveBeenCalled()
    expect(written().path).toBe('/docs/notes.md')
    expect(asText(written().bytes)).toBe('hello')
    expect(dispatch).toHaveBeenCalledWith('mt::tab-saved', ['t1'])
    expect(result).toBe('/docs/notes.md')
  })

  it('converts line endings only when the document asks', async() => {
    const { saveDocument } = await load()
    const document = {
      id: 't1',
      filename: 'notes.md',
      pathname: '/docs/notes.md',
      markdown: 'a\nb\n'
    }

    await saveDocument(
      { ...document, options: { encoding: UTF8, lineEnding: 'crlf', adjustLineEndingOnSave: true } },
      vi.fn()
    )
    expect(asText(written().bytes)).toBe('a\r\nb\r\n')

    invoke.mockClear()
    await saveDocument(
      { ...document, options: { encoding: UTF8, lineEnding: 'crlf', adjustLineEndingOnSave: false } },
      vi.fn()
    )
    expect(asText(written().bytes), 'left alone without the flag').toBe('a\nb\n')
  })

  it('writes a byte-order mark when the document had one', async() => {
    const { saveDocument } = await load()

    await saveDocument(
      {
        id: 't1',
        filename: 'notes.md',
        pathname: '/docs/notes.md',
        markdown: 'hi',
        options: { encoding: { encoding: 'utf8', isBom: true }, lineEnding: 'lf' }
      },
      vi.fn()
    )

    expect(written().bytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
    expect(asText(written().bytes.slice(3))).toBe('hi')
  })

  it('refuses a non-UTF-8 document rather than re-encoding it', async() => {
    const { saveDocument } = await load()
    const dispatch = vi.fn()

    const result = await saveDocument(
      {
        id: 't1',
        filename: 'legacy.md',
        pathname: '/docs/legacy.md',
        markdown: '中文',
        options: { encoding: { encoding: 'gbk', isBom: false }, lineEnding: 'lf' }
      },
      dispatch
    )

    expect(
      invoke.mock.calls.some(([command]) => command === 'write_file'),
      'the file must be left as it was'
    ).toBe(false)
    expect(dispatch.mock.calls[0][0]).toBe('mt::tab-save-failure')
    expect(result).toBeNull()
  })

  it('adopts the path chosen for an untitled document', async() => {
    const { saveDocument } = await load()
    const dispatch = vi.fn()
    showSaveDialog.mockResolvedValue('/docs/chosen.md')

    await saveDocument({ id: 't1', filename: 'Untitled', markdown: '# Title\n' }, dispatch)

    expect(written().path).toBe('/docs/chosen.md')
    expect(dispatch).toHaveBeenCalledWith('mt::set-pathname', [
      { id: 't1', pathname: '/docs/chosen.md', filename: 'chosen.md' }
    ])
  })

  it('suggests the first heading as the filename', async() => {
    const { saveDocument } = await load()
    showSaveDialog.mockResolvedValue(null)

    await saveDocument({ id: 't1', filename: 'Untitled', markdown: '## Sub\n# Main\n' }, vi.fn())

    // The top-level heading wins over the earlier but deeper one.
    expect(showSaveDialog).toHaveBeenCalledWith({ defaultPath: 'Main.md' })
  })

  it('appends .md when the chosen name has no extension', async() => {
    const { saveDocument } = await load()
    showSaveDialog.mockResolvedValue('/docs/no-extension')

    await saveDocument({ id: 't1', filename: 'Untitled', markdown: 'x' }, vi.fn())

    expect(written().path).toBe('/docs/no-extension.md')
  })

  it('says nothing when the save dialog is dismissed', async() => {
    const { saveDocument } = await load()
    const dispatch = vi.fn()
    showSaveDialog.mockResolvedValue(null)

    const result = await saveDocument({ id: 't1', filename: 'Untitled', markdown: 'x' }, dispatch)

    expect(invoke.mock.calls.some(([command]) => command === 'write_file')).toBe(false)
    // Cancelling is not a failure; a notification here would be noise.
    expect(dispatch).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})
