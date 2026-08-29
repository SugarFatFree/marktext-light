// Every themed colour must resolve.
//
// `var(--missing)` with no fallback makes the whole declaration invalid, so a
// mistyped variable name does not fail loudly — a border silently disappears,
// or text falls back to an inherited colour that may have no contrast against
// the current theme. Three of these were sitting in the image-uploader
// settings (`--editorColor20`, `--editorColor70`), neither of which any theme
// has ever defined.
//
// A literal fallback is not a free pass either when it is a fixed colour: the
// six `var(--editorColor70, #666)` usages rendered mid-grey on every dark
// theme. Those are caught by review rather than here, but an undefined name is
// mechanical enough to assert.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'

const DESKTOP_ROOT = resolve(__dirname, '../../..')
const RENDERER = join(DESKTOP_ROOT, 'src/renderer/src')

const walk = (dir: string, extensions: string[]): string[] => {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...walk(path, extensions))
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      found.push(path)
    }
  }
  return found
}

const STYLE_FILES = walk(RENDERER, ['.vue', '.css'])

/** Custom properties inherit, so a definition anywhere in the tree counts. */
const definedNames = (): Set<string> => {
  const names = new Set<string>()
  for (const file of STYLE_FILES) {
    for (const match of readFileSync(file, 'utf-8').matchAll(/(--[\w-]+)\s*:/g)) {
      names.add(match[1])
    }
  }
  return names
}

interface Usage {
  name: string
  file: string
  hasFallback: boolean
}

const usages = (): Usage[] => {
  const found: Usage[] = []
  for (const file of STYLE_FILES) {
    // Capture the character after the name so a fallback can be told apart:
    // `var(--x)` has none, `var(--x, y)` does.
    for (const match of readFileSync(file, 'utf-8').matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)) {
      found.push({
        name: match[1],
        file: relative(DESKTOP_ROOT, file),
        hasFallback: match[2] === ','
      })
    }
  }
  return found
}

describe('theme custom properties', () => {
  const defined = definedNames()
  const all = usages()

  it('finds styles to check', () => {
    expect(STYLE_FILES.length).toBeGreaterThan(20)
    expect(all.length).toBeGreaterThan(100)
  })

  it('never reads a custom property no stylesheet defines', () => {
    const undefinedUsages = all
      .filter((usage) => !defined.has(usage.name))
      .map((usage) => `${usage.name} in ${usage.file}${usage.hasFallback ? ' (has fallback)' : ''}`)

    expect([...new Set(undefinedUsages)].sort()).toEqual([])
  })
})
