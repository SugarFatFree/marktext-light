// Every locale must carry the same keys as English.
//
// A missing key degrades quietly: the renderer's `t()` falls back to English
// and the native menu's Rust resolver does the same, so a half-translated UI
// looks like a design choice rather than a bug. The Tauri theme menu shipped
// that way — `menu.theme.followSystem` and `menu.theme.light` were added to
// English and Simplified Chinese only, and the other eight silently showed
// English entries in an otherwise translated menu.
//
// An extra key is worth failing on too: it is either a typo that will never be
// read, or a key removed from English that these files still carry.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { resolve } from 'path'

const LOCALES_DIR = resolve(__dirname, '../../../static/locales')

const flatten = (value: unknown, prefix = ''): Set<string> => {
  const keys = new Set<string>()
  if (!value || typeof value !== 'object') return keys
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = `${prefix}${key}`
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      for (const nested of flatten(child, `${path}.`)) keys.add(nested)
    } else {
      keys.add(path)
    }
  }
  return keys
}

const keysOf = (file: string): Set<string> =>
  flatten(JSON.parse(readFileSync(resolve(LOCALES_DIR, file), 'utf-8')))

// `.min.json` files are build output, not sources.
const localeFiles = readdirSync(LOCALES_DIR).filter(
  (file) => file.endsWith('.json') && !file.endsWith('.min.json') && file !== 'en.json'
)

describe('locale key parity', () => {
  const english = keysOf('en.json')

  it('has locales to check', () => {
    expect(english.size).toBeGreaterThan(0)
    expect(localeFiles.length).toBeGreaterThan(0)
  })

  it.each(localeFiles)('%s covers exactly the English keys', (file) => {
    const keys = keysOf(file)

    expect({
      missing: [...english].filter((key) => !keys.has(key)).sort(),
      extra: [...keys].filter((key) => !english.has(key)).sort()
    }).toEqual({ missing: [], extra: [] })
  })
})
