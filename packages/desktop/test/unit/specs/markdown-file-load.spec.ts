// What the renderer asks the loader for, and what it does with a document that
// is not plain LF UTF-8.
//
// The decoding itself is Rust's (src-tauri/src/commands/markdown.rs, tested
// there). What is testable here is the question the renderer has to answer
// before it can ask: which line ending to assume when the file itself does not
// say. Getting that wrong is invisible until a save rewrites every line of a
// Windows document.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const invoke = vi.fn()
const getStoredPreference = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }))
vi.mock('../../../src/renderer/src/tauri-bridge/preferences', () => ({
  getStoredPreference: (key: string) => getStoredPreference(key)
}))

const load = async() => {
  vi.resetModules()
  return import('../../../src/renderer/src/tauri-bridge/markdown-file')
}

/** The arguments of the single `read_markdown_file` call. */
const askedFor = (): Record<string, unknown> =>
  invoke.mock.calls.find(([command]) => command === 'read_markdown_file')![1] as Record<
    string,
    unknown
  >

describe('loading a markdown file', () => {
  beforeEach(() => {
    invoke.mockReset()
    getStoredPreference.mockReset()
    invoke.mockResolvedValue({ markdown: '', encoding: { encoding: 'utf8', isBom: false } })
    getStoredPreference.mockResolvedValue(undefined)
  })

  it('assumes CRLF on Windows when no preference is set', async() => {
    const { loadMarkdownFile } = await load()
    getStoredPreference.mockImplementation(async(key: string) =>
      key === 'endOfLine' ? 'default' : undefined
    )

    await loadMarkdownFile('/docs/a.md', 'win32')

    // Mirrors `Preference.getPreferredEol`. Only reached for a file with no
    // line break of its own — but that includes every new empty document.
    expect(askedFor().preferredEol).toBe('crlf')
  })

  it('assumes LF everywhere else', async() => {
    const { loadMarkdownFile } = await load()
    getStoredPreference.mockImplementation(async(key: string) =>
      key === 'endOfLine' ? 'default' : undefined
    )

    await loadMarkdownFile('/docs/a.md', 'darwin')

    expect(askedFor().preferredEol).toBe('lf')
  })

  it('lets an explicit preference override the platform', async() => {
    const { loadMarkdownFile } = await load()
    getStoredPreference.mockImplementation(async(key: string) =>
      key === 'endOfLine' ? 'lf' : undefined
    )

    await loadMarkdownFile('/docs/a.md', 'win32')

    expect(askedFor().preferredEol).toBe('lf')
  })

  it('passes the normalise-every-file preference through as a boolean', async() => {
    const { loadMarkdownFile } = await load()
    getStoredPreference.mockImplementation(async(key: string) =>
      key === 'autoNormalizeLineEndings' ? true : undefined
    )

    await loadMarkdownFile('/docs/a.md', 'linux')

    // Rust deserializes into `Option<bool>`; an undefined preference must not
    // arrive as `undefined` and be read as "no opinion" on one side and
    // "false" on the other.
    expect(askedFor().autoNormalizeLineEndings).toBe(true)
  })

  it('defaults the normalise preference to false rather than undefined', async() => {
    const { loadMarkdownFile } = await load()

    await loadMarkdownFile('/docs/a.md', 'linux')

    expect(askedFor().autoNormalizeLineEndings).toBe(false)
  })

  it('lets the loader error reach the caller', async() => {
    const { loadMarkdownFile } = await load()
    invoke.mockRejectedValue(new Error('No such file or directory (os error 2)'))

    // The caller turns this into the "cannot read" notification. Swallowing it
    // here is how a click on a file in the tree used to do nothing at all.
    await expect(loadMarkdownFile('/docs/gone.md', 'linux')).rejects.toThrow('os error 2')
  })
})
