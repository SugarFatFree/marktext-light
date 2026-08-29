// The legacy muya engine is gone from this package.
//
// `packages/muyajs` is the old JavaScript editor; `@muyajs/core`
// (`packages/muya`) replaced it. The plan has called it "being retired" for a
// while, with "a handful of call sites remaining". There are none — so the
// `muya` alias, and the ambient declarations that made `muya/lib/...` typecheck,
// are gone too.
//
// Removing the alias is the part that matters. Left in place it is a working
// path back to the retired engine: an import that resolves, typechecks, and
// bundles a second editor into the app, with nothing to object.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, relative } from 'path'

const DESKTOP = resolve(__dirname, '../../..')

const sourceFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.(ts|vue|js)$/.test(entry)) out.push(path)
  }
  return out
}

describe('the retired muya engine', () => {
  it('is imported nowhere', () => {
    const offenders: string[] = []
    for (const path of [...sourceFiles(join(DESKTOP, 'src')), ...sourceFiles(join(DESKTOP, 'test'))]) {
      if (path.endsWith('legacy-engine-retired.spec.ts')) continue
      const source = readFileSync(path, 'utf-8')
      if (/from\s+['"]muya\/|require\(['"]muya\/|import\(['"]muya\//.test(source)) {
        offenders.push(relative(DESKTOP, path))
      }
    }

    expect(offenders, 'reaches the retired engine').toEqual([])
  })

  it('has no alias left to reach it through', () => {
    for (const config of [
      'electron.vite.config.ts',
      'vite.tauri.config.ts',
      'vitest.config.ts',
      'tsconfig.base.json'
    ]) {
      const source = readFileSync(join(DESKTOP, config), 'utf-8')

      // `../muyajs` is the retired package's path. Matching bare "muyajs"
      // would also hit `@muyajs/core`, which is the engine in use.
      expect(source, `${config} still aliases the retired engine`).not.toMatch(/\.\.\/muyajs/)
    }
  })

  it('still resolves the engine that replaced it', () => {
    // The point is not "no muya" — it is "one muya". `@muyajs/core` keeps its
    // path mapping, and removing that would break the editor outright.
    const tsconfig = readFileSync(join(DESKTOP, 'tsconfig.base.json'), 'utf-8')

    expect(tsconfig).toMatch(/"@muyajs\/core"/)
  })
})
