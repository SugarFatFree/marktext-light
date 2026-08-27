// Every translation key anyone asks for by name must exist in the locale files.
//
// A key that is not there does not throw — it renders as itself. The menu reads
// "menu.file.newTab", a button reads "dialog.cancel", and nothing fails. Both
// sides that look keys up are internally consistent, so neither notices:
//
//   - the Tauri menu is built in Rust and resolves labels at runtime from JSON
//     shipped as a resource;
//   - the renderer calls `t('…')` in some five hundred places, and carries the
//     custom menu bar's labels as data (`labelKey` / `titleKey`).
//
// `locale-parity.spec.ts` covers the complement: that the ten locales agree on
// which keys exist. This covers whether the keys anyone asks for are among them.
//
// Only literal keys are checked. A key built at runtime — `t(\`x.${y}\`)` —
// cannot be resolved from the source, and pretending otherwise would mean
// either false alarms or a rule nobody can follow.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, relative } from 'path'

const RUST = resolve(__dirname, '../../../src-tauri/src')
const RENDERER = resolve(__dirname, '../../../src/renderer/src')
const EN_LOCALE = resolve(__dirname, '../../../static/locales/en.json')

const filesUnder = (dir: string, ...extensions: string[]): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, ...extensions))
    else if (extensions.some((extension) => entry.endsWith(extension))) out.push(path)
  }
  return out
}

/** Rust's own tests look up keys that are meant to be absent — that is what
 *  they assert. Test modules come last by convention, so drop from there. */
const withoutRustTests = (source: string): string => {
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

interface Ask {
  where: string
  key: string
}

const asksIn = (path: string, source: string, patterns: RegExp[], root: string): Ask[] =>
  patterns.flatMap((pattern) =>
    [...source.matchAll(pattern)].map(([, key]) => ({
      where: relative(root, path),
      key: key as string
    }))
  )

describe('translation keys resolve', () => {
  const en = JSON.parse(readFileSync(EN_LOCALE, 'utf-8')) as Record<string, unknown>

  const check = (asks: Ask[], atLeast: number, what: string): void => {
    // A regex that stops matching would leave nothing to check and pass in
    // silence, which is the second failure this guards against.
    expect(asks.length, `found no translation lookups in ${what} at all`)
      .toBeGreaterThan(atLeast)

    const missing = asks
      .filter((ask) => typeof lookup(en, ask.key) !== 'string')
      .map((ask) => `${ask.where}: ${ask.key}`)

    expect([...new Set(missing)], `${what} would show these raw keys`).toEqual([])
  }

  it('resolves every key the Tauri menu looks up', () => {
    const asks = filesUnder(RUST, '.rs').flatMap((path) =>
      asksIn(path, withoutRustTests(readFileSync(path, 'utf-8')), [/\.t\(\s*"([^"]+)"/g], RUST)
    )

    check(asks, 50, 'the Rust menu')
  })

  it('resolves every key the renderer names', () => {
    // `t('a.b')` as called from components and stores, plus the custom menu
    // bar, which carries its labels as data rather than as calls.
    const patterns = [/\bt\(\s*'([A-Za-z][\w.]*)'/g, /(?:label|title)Key:\s*'([\w.]+)'/g]
    const asks = filesUnder(RENDERER, '.ts', '.vue').flatMap((path) =>
      asksIn(path, readFileSync(path, 'utf-8'), patterns, RENDERER)
    )

    check(asks, 300, 'the renderer')
  })
})
