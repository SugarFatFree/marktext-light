// Large-document parse guard.
//
// Opening a file runs the markdown through `MarkdownToState` before anything is
// rendered, so this is where a big document either stays usable or stops being
// one. Two hazards live here, and only the first can be asserted without
// turning wall-clock time into a flaky test:
//
//  1. Expanding a token list with `push(...tokens)` / `unshift(...tokens)`
//     passes every token as a separate argument, which overflows the call stack
//     once a document is large enough. A 1 MB document used to throw
//     `RangeError: Maximum call stack size exceeded` and simply could not be
//     opened. That is a hard pass/fail and is asserted below.
//
//  2. Quadratic parsing. Two hot spots were removed (marked's `walkTokens`
//     accumulator and the array-as-queue in `markdownToState`), which took a
//     2 MB document from ~101 s to ~3 s. What remains still grows faster than
//     linearly, so the timings are printed for a human to read rather than
//     asserted — a threshold tight enough to catch a regression would fire on a
//     loaded CI runner instead.

import { describe, it, expect } from 'vitest'
import { MarkdownToState } from '@muyajs/core/state/markdownToState'

const PARSE_OPTIONS = {
  footnote: false,
  math: true,
  isGitlabCompatibilityEnabled: true,
  trimUnnecessaryCodeBlockEmptyLines: false,
  frontMatter: true
}

/**
 * A repeating block of prose, headings, lists, code, tables and inline markup —
 * a document made only of paragraphs would exercise one code path and flatter
 * the parser.
 */
const SECTION = `
## Section heading

Some **bold** and *italic* prose with a [link](https://example.com) and \`inline code\`,
long enough to span more than one line so the inline lexer has real work to do.

- first bullet with **emphasis**
- second bullet with \`code\`
- third bullet

1. ordered one
2. ordered two

> A blockquote with some text in it.

\`\`\`js
const value = compute(1, 2)
console.log(value)
\`\`\`

| column a | column b |
| --- | --- |
| one | two |
| three | four |

`

const documentOfSize = (targetBytes: number): string => {
  const repeats = Math.ceil(targetBytes / SECTION.length)
  return `# Generated document\n${SECTION.repeat(repeats)}`
}

const MB = 1024 * 1024

const parse = (markdown: string): { states: unknown[]; elapsed: number } => {
  const started = performance.now()
  const states = new MarkdownToState(PARSE_OPTIONS).generate(markdown)
  return { states, elapsed: performance.now() - started }
}

describe('large document parsing', () => {
  it('parses documents far past the old call-stack limit', () => {
    const { states, elapsed } = parse(documentOfSize(2 * MB))
    console.log(`  2 MB parsed in ${elapsed.toFixed(0)} ms`)
    expect(states.length).toBeGreaterThan(0)
  }, 120_000)

  it('reports how parse cost grows with size', () => {
    for (const mb of [0.5, 1, 2]) {
      const { elapsed } = parse(documentOfSize(mb * MB))
      console.log(`  ${mb} MB parsed in ${elapsed.toFixed(0)} ms`)
    }
  }, 120_000)
})
