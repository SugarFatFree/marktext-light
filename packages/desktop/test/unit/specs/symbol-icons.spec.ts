// The SVG sprite injected at startup carries only icons that are used.
//
// It shipped 42 symbols; three `<use>` tags referenced two of them. The other
// forty were 41.7 KB of the first-paint bundle, parsed and injected into the
// DOM of every window, for nothing.
//
// The sprite cannot be deferred — it has to be in the document before the first
// `<use>` renders, and those are visible on launch — so what it holds is the
// only thing to be careful about.
//
// Trimming it is only safe while every reference is a literal. A dynamically
// built id (`'#icon-' + name`) would not appear in this scan, so that is
// asserted too rather than assumed.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve } from 'path'

const RENDERER = resolve(__dirname, '../../../src/renderer/src')
const SPRITE = resolve(RENDERER, 'assets/symbolIcon/index.js')

const sourceFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (path.includes('symbolIcon')) continue
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(vue|ts|js)$/.test(entry)) out.push(path)
  }
  return out
}

const sprite = readFileSync(SPRITE, 'utf-8')
const defined = new Set(
  [...sprite.matchAll(/<symbol id="(icon-[a-z0-9-]+)"/g)].map((m) => m[1] as string)
)

const referenced = (): Set<string> => {
  const found = new Set<string>()
  for (const path of sourceFiles(RENDERER)) {
    for (const m of readFileSync(path, 'utf-8').matchAll(/#(icon-[a-z0-9-]+)/g)) {
      found.add(m[1] as string)
    }
  }
  return found
}

describe('the icon sprite', () => {
  it('defines every icon that is referenced', () => {
    const missing = [...referenced()].filter((id) => !defined.has(id))

    expect(missing, 'referenced by a <use> but absent from the sprite').toEqual([])
  })

  it('carries nothing that is never referenced', () => {
    const used = referenced()
    const dead = [...defined].filter((id) => !used.has(id))

    expect(dead, 'in the sprite but used nowhere').toEqual([])
  })

  it('is only referenced by literal ids, which is what makes the scan sound', () => {
    // A template or concatenation would hide a reference from both checks
    // above, and the trimmed sprite would be missing an icon at runtime.
    const offenders: string[] = []
    for (const path of sourceFiles(RENDERER)) {
      const source = readFileSync(path, 'utf-8')
      if (/['"`]#icon-['"`]|#icon-\$\{|'#icon-' *\+|`#icon-\$/.test(source)) {
        offenders.push(path.replace(RENDERER, ''))
      }
    }

    expect(offenders, 'builds a sprite id at runtime; the sprite cannot be trimmed by scanning')
      .toEqual([])
  })
})
