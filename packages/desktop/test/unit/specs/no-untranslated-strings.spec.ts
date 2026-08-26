// Text the user reads must come from the locale files, including the text that
// lives in attributes.
//
// `locale-parity.spec.ts` checks that all ten locales carry the same keys. That
// says nothing about whether a string reached a locale file at all: a
// `placeholder="Enter .md file name"` written straight into a template is
// perfectly consistent across ten languages and still shows English to every
// one of them. That exact line sat in the sidebar until it was found by
// scanning rather than by anyone noticing.
//
// Two places are checked: template attributes, and the notifications raised
// from script. Text between tags is not — it is far more visible while writing
// a template, and the few literals there are file extensions, the product name
// and shell commands, all of which would be wrong to translate.
//
// An empty `alt` passes, and should: an icon whose meaning is already carried
// by the text beside it wants no alternative text, not a translated one.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, resolve, relative } from 'path'

const RENDERER = resolve(__dirname, '../../../src/renderer/src')

/** Attributes whose value a user reads or hears. */
const VISIBLE = ['placeholder', 'title', 'alt', 'aria-label']

/** Three letters in a row is prose; `.md`, `#fff` and `1.0` are not. */
const LOOKS_LIKE_PROSE = /[A-Za-z]{3}/

const filesUnder = (dir: string, ...extensions: string[]): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, ...extensions))
    else if (extensions.some((extension) => entry.endsWith(extension))) out.push(path)
  }
  return out
}

const vueFiles = (dir: string): string[] => filesUnder(dir, '.vue')

const templateOf = (source: string): string => {
  const match = /<template>([\s\S]*?)\n<\/template>/.exec(source)
  if (!match) return ''

  // Commented-out markup is not rendered, and the comments around it often
  // discuss the very strings being looked for.
  return match[1]!.replace(/<!--[\s\S]*?-->/g, '')
}

describe('user-visible attributes are translated', () => {
  it('has no literal prose in a static placeholder, title, alt or aria-label', () => {
    const offenders: string[] = []

    for (const path of vueFiles(RENDERER)) {
      const template = templateOf(readFileSync(path, 'utf-8'))
      for (const attribute of VISIBLE) {
        // A leading `:` or `v-bind:` means the value is an expression — which
        // is how a template reaches `t(...)`. Only literals are of interest.
        const literal = new RegExp(`(?<![:\\w-])${attribute}="([^"]+)"`, 'g')
        for (const [, value] of template.matchAll(literal)) {
          if (LOOKS_LIKE_PROSE.test(value as string)) {
            offenders.push(`${relative(RENDERER, path)}: ${attribute}="${value}"`)
          }
        }
      }
    }

    expect(offenders, 'bind these to a locale key, or clear the attribute if it is decorative')
      .toEqual([])
  })

  it('raises no notification with a literal title or message', () => {
    // A notification is read the moment something goes wrong, which is the
    // worst moment to be shown a language the user does not read. These were
    // all English until they were scanned for — sidebar delete and paste
    // failures among them.
    const offenders: string[] = []

    for (const path of filesUnder(RENDERER, '.ts', '.vue')) {
      const source = readFileSync(path, 'utf-8')
      for (const [, call] of source.matchAll(/notify\(\{([\s\S]{0,400}?)\}\)/g)) {
        for (const field of ['title', 'message']) {
          const literal = new RegExp(`${field}:\\s*(['"])(.*?)\\1`, 'g')
          for (const [, , value] of (call as string).matchAll(literal)) {
            if (LOOKS_LIKE_PROSE.test(value as string)) {
              offenders.push(`${relative(RENDERER, path)}: ${field}: '${value}'`)
            }
          }
        }
      }
    }

    expect(offenders, 'notification text belongs in the locale files').toEqual([])
  })
})
