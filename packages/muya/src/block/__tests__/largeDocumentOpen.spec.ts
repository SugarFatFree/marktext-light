// @vitest-environment happy-dom

// Where opening a large document actually spends its time.
//
// Parsing was made linear (see state/__tests__/largeDocumentParse.spec.ts), but
// a reader waits for the whole of `Muya.init()`: parse, then building the block
// tree, then rendering it. That second half had never been measured, and it is
// the expensive one.
//
// Measured here, on one machine, in happy-dom (slower than a browser in
// absolute terms — the ratios are the point, not the milliseconds):
//
//   headings + paragraphs   200 -> 1331 ms    400 -> 2710 ms    (2.0x, linear)
//   blockquotes             200 ->  428 ms    400 -> 1330 ms    (3.1x)
//   bullet lists            200 -> 1839 ms    400 -> 6255 ms    (3.4x)
//
// So the excess is specific to container blocks, lists worst of all — 400
// sections of a three-item list is 15 KB of markdown and takes seconds. A real
// window agrees: ~850 KB of mixed prose left the renderer unresponsive past a
// 105 s timeout in CI.
//
// Three suspects were measured and cleared, so they need not be re-checked:
//   - parsing: 52 ms for 782 KB
//   - the two whole-document `deepClone`s per `dispatch`: 42 ms for 782 KB
//   - `path` / `LinkedList.offset`, which is O(siblings): called 5 times total
//
// Nothing here asserts a duration. A threshold tight enough to catch the
// regression would fire on a loaded runner instead; the numbers are logged so a
// change in shape is visible when someone looks.

import { describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

const listSection = (i: number): string => `## Section ${i}\n- a ${i}\n- b ${i}\n- c ${i}\n\n`;
function proseSection(i: number): string {
    return `## Section ${i}\n${`Prose with **bold** and \`code\` in section ${i}. `.repeat(10)}\n\n`;
}

function build(sections: number, section: (i: number) => string): string {
    const parts = ['# Document\n'];
    for (let i = 0; i < sections; i++)
        parts.push(section(i));

    return parts.join('');
}

function open(markdown: string): { muya: Muya; ms: number } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const started = Date.now();
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();

    return { muya, ms: Date.now() - started };
}

describe('opening a document', () => {
    it('builds the whole tree, whatever it is made of', () => {
        for (const [label, section] of [['prose', proseSection], ['lists', listSection]] as const) {
            for (const sections of [100, 200]) {
                const markdown = build(sections, section);
                const { muya, ms } = open(markdown);

                // The state is the tree; a short one means blocks were dropped
                // rather than merely built slowly.
                expect(muya.getState().length).toBeGreaterThanOrEqual(sections);

                // The whole point of this spec is to report these numbers;
                // there is nothing to assert about them that would not be flaky.
                // eslint-disable-next-line no-console
                console.log(
                    `${label} x${sections} (${Math.round(markdown.length / 1024)} KB): ${ms} ms`,
                );
            }
        }
    }, 300000);
});
