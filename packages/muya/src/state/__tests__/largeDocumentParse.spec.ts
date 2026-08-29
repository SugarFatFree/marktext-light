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
//     accumulator and the array-as-queue in `markdownToState`), taking a 2 MB
//     document from ~101 s to ~3 s. Measured after that work, on one machine:
//     0.5 MB 250 ms, 1 MB 792 ms, 2 MB 2937 ms — still worse than linear.
//     Those numbers are not asserted: a threshold tight enough to catch a
//     regression would fire on a loaded CI runner instead.

import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';

const PARSE_OPTIONS = {
    footnote: false,
    math: true,
    isGitlabCompatibilityEnabled: true,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: true,
};

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

`;

function documentOfSize(targetBytes: number): string {
    const repeats = Math.ceil(targetBytes / SECTION.length);
    return `# Generated document\n${SECTION.repeat(repeats)}`;
}

const MB = 1024 * 1024;

describe('large document parsing', () => {
    it('parses documents far past the old call-stack limit', () => {
        const states = new MarkdownToState(PARSE_OPTIONS).generate(documentOfSize(2 * MB));

        expect(states.length).toBeGreaterThan(0);
    }, 120_000);
});
