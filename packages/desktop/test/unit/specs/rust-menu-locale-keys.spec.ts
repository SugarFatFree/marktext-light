// Every translation key the Tauri menu asks for must exist in the locale files.
//
// Nothing else links these two. The menu is built in Rust and looks its labels
// up by key at runtime; the keys live in JSON shipped as a resource. A typo, or
// a menu item added before its key, produces a menu that reads
// "menu.file.newTab" — and no Rust test and no locale test would notice, because
// each side is internally consistent.
//
// `locale-parity.spec.ts` covers the other half: that the ten locales agree on
// which keys exist. This covers whether the keys anyone asks for are among them.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, relative } from 'path'

const RUST = resolve(__dirname, '../../../src-tauri/src')
const EN_LOCALE = resolve(__dirname, '../../../static/locales/en.json')

const rustFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...rustFiles(path))
    else if (entry.endsWith('.rs')) out.push(path)
  }
  return out
}

/** Rust's own tests call the translator with keys that are meant to be absent —
 *  that is what they are testing. Test modules are last in the file by
 *  convention, so everything from the attribute onwards is dropped. */
const withoutTests = (source: string): string => {
  const index = source.indexOf('#[cfg(test)]')

  return index === -1 ? source : source.slice(0, index)
}

const lookup = (json: Record<string, unknown>, key: string): unknown => {
  let node: unknown = json
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return undefined
    node = (node as Record<string, unknown>)[part]
  }

  return node
}

describe('the Tauri menu asks only for keys that exist', () => {
  it('finds every key it looks up in the English locale', () => {
    const en = JSON.parse(readFileSync(EN_LOCALE, 'utf-8')) as Record<string, unknown>
    const missing: string[] = []
    let found = 0

    for (const path of rustFiles(RUST)) {
      const source = withoutTests(readFileSync(path, 'utf-8'))
      for (const [, key] of source.matchAll(/\.t\(\s*"([^"]+)"/g)) {
        found++
        if (typeof lookup(en, key as string) !== 'string') {
          missing.push(`${relative(RUST, path)}: ${key}`)
        }
      }
    }

    // A regex that stopped matching would leave nothing to check and pass
    // silently, which is the failure this guards against second.
    expect(found, 'no translation lookups found in the Rust sources at all')
      .toBeGreaterThan(50)
    expect(missing, 'the menu would show these raw keys instead of labels').toEqual([])
  })
})
