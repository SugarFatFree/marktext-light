// `isTauri` is a function, so a template that tests it directly tests a
// function object — always truthy. `v-if="isTauri"` renders always and
// `v-if="!isTauri"` renders never, and both look reasonable in review.
//
// Neither the compiler nor vue-tsc objects: `!fn` is valid TypeScript. The
// only thing that catches it is running the build you did not mean to change,
// which is how it nearly went out — a Tauri-only gate that would have hidden
// two settings rows from the Electron build as well.

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve, relative } from 'path'

const RENDERER = resolve(__dirname, '../../../src/renderer/src')

const vueFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...vueFiles(path))
    else if (entry.endsWith('.vue')) out.push(path)
  }
  return out
}

/** The template half of a single-file component, where the mistake lives. */
const templateOf = (source: string): string => {
  const start = source.indexOf('<template>')
  const end = source.lastIndexOf('</template>')
  return start === -1 || end === -1 ? '' : source.slice(start, end)
}

describe('isTauri', () => {
  it('is never used bare in a template', () => {
    const offenders = vueFiles(RENDERER)
      .filter((path) => /\bisTauri\b(?!\s*\()/.test(templateOf(readFileSync(path, 'utf-8'))))
      .map((path) => relative(RENDERER, path))

    expect(
      offenders,
      'call it in the script and bind the boolean, e.g. `const runningInTauri = isTauri()`'
    ).toEqual([])
  })

  it('is resolved to a boolean where a template does gate on it', () => {
    const general = readFileSync(
      join(RENDERER, 'prefComponents/general/index.vue'),
      'utf-8'
    )

    // The "open in new window" switches promise something this build will not
    // do — every file opens as a tab, and so does New Window.
    expect(general).toMatch(/const runningInTauri = isTauri\(\)/)
    expect(templateOf(general)).toMatch(/v-if="!runningInTauri"[\s\S]*openFilesInNewWindow/)
    expect(templateOf(general)).toMatch(/v-if="!runningInTauri"[\s\S]*openFoldersInNewWindow/)
  })
})
