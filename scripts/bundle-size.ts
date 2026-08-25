// Reports what an editor window has to download before it can paint.
//
// The number that matters is not the largest chunk but the *static* closure
// reachable from the entry plus the editor route: anything behind a dynamic
// import (mermaid, katex, the themes, source-code mode) is fetched later, if
// ever, and does not belong in the figure.
//
// Run after `pnpm run tauri:build-renderer`:
//   pnpm run bundle-size

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, resolve } from 'path'

const ASSETS = resolve(process.cwd(), 'packages/desktop/out-tauri/renderer/assets')
const INDEX_HTML = resolve(process.cwd(), 'packages/desktop/out-tauri/renderer/index.html')

// Emitted form of a chunk-to-chunk static import: `from"./x.js"` / `import"./x.js"`.
const STATIC_IMPORT = /(?:from|import)\s*"\.\/([^"]+\.js)"/g

const dependencies = (name: string): Set<string> => {
  const path = join(ASSETS, name)
  if (!existsSync(path)) return new Set()
  const source = readFileSync(path, 'utf-8')
  return new Set([...source.matchAll(STATIC_IMPORT)].map((match) => match[1]))
}

const closure = (roots: string[]): Set<string> => {
  const seen = new Set<string>()
  const stack = [...roots]
  while (stack.length) {
    const name = stack.pop()!
    if (seen.has(name)) continue
    seen.add(name)
    for (const dep of dependencies(name)) {
      if (!seen.has(dep)) stack.push(dep)
    }
  }
  return seen
}

const sizeOf = (name: string): number => {
  const path = join(ASSETS, name)
  return existsSync(path) ? statSync(path).size : 0
}

const kb = (names: Iterable<string>): number =>
  Math.round([...names].reduce((total, name) => total + sizeOf(name), 0) / 1024)

if (!existsSync(INDEX_HTML)) {
  console.error('No renderer build found. Run `pnpm run tauri:build-renderer` first.')
  process.exit(1)
}

const entry = /assets\/([^"]+\.js)/.exec(readFileSync(INDEX_HTML, 'utf-8'))?.[1]
if (!entry) {
  console.error('Could not find the entry chunk in index.html.')
  process.exit(1)
}

const editorRoute = readdirSync(ASSETS).find((f) => f.startsWith('app-') && f.endsWith('.js'))
if (!editorRoute) {
  console.error('Could not find the editor route chunk (app-*.js).')
  process.exit(1)
}

const firstPaint = closure([entry, editorRoute])

console.log(`entry chunk           ${kb([entry])} KB`)
console.log(`editor first paint    ${kb(firstPaint)} KB across ${firstPaint.size} chunks`)
for (const name of [...firstPaint].sort((a, b) => sizeOf(b) - sizeOf(a)).slice(0, 6)) {
  console.log(`  ${String(Math.round(sizeOf(name) / 1024)).padStart(6)} KB  ${name}`)
}
