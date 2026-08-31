// Lexing must cost in proportion to how much text there is, not to its square.
//
// The e2e suite already holds that line for *documents*, by varying the number
// of blocks. Line length is a different shape and was not covered at all: a
// document of a thousand short paragraphs and one of a single enormous one are
// the same number of bytes and go down different paths. One very long line is
// the classic way to stop an editor — a minified JSON payload pasted into a
// paragraph, a base64 image, a log line.
//
// Measured per marker type at 8 / 32 / 128 KB, one line, on an idle machine:
//
//     plain      1.12  1.06  1.04 ms/KB     flat
//     em *a*     2.77  2.99  2.42            flat
//     em _b_     2.25  2.32  2.38            flat
//     code `c`   0.39  0.70  0.40            flat
//     del ~~f~~  0.46  0.45  0.46            flat
//     link       1.64  3.31  8.59            NOT flat — see below
//
// Links are the one rule that is superlinear in line length, and it is the
// regex: the destination is matched with a greedy `(.*)`, which runs to the end
// of the line and backtracks to the closing paren. Correct — checked, not
// assumed: `[a](b) and (c)` still yields href `b` — but O(line) per link, so
// O(n^2) for a line that is nothing but links.
//
// That is left alone here. Rewriting the link rule is a change to the core
// parser whose only real judge is the 670-fixture conformance suite, and it
// wants a session of its own rather than a slot in a scheduled sweep. The link
// case below therefore has an allowance wide enough for what is already
// happening and narrow enough to catch it getting worse.
//
// What each test asserts is the *slope*: cost per KB at the large size against
// cost per KB at the small one. A duration would fail on a busy runner; a ratio
// of two measurements taken seconds apart moves together.

import { describe, expect, it } from 'vitest';
import { lexBlock } from '../../utils/marked/lexBlock';
import { tokenizer } from '../lexer';

/**
 * Generous on purpose. The small measurement carries the fixed costs — a first
 * call that is still warming up, a regex compiled once — so its per-KB figure
 * is the higher of the two in every run recorded here. Anything at or below 1
 * is flat or better; the quadratic this guards against would put the large
 * figure many times over the small one, not a fraction above it.
 */
const ALLOWANCE = 2.5;

/**
 * For links only. Measured at 2.0 across the 8x range the test uses (1.64 ->
 * 3.31 ms/KB); set above that with room for a noisy runner, and well below the
 * 5.2 the same rule shows across 16x.
 */
const LINK_ALLOWANCE = 3.5;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

function msPerKb(text: string, run: (src: string) => unknown, times = 5): number {
    const runs = Array.from({ length: times }, () => {
        const t0 = performance.now();
        run(text);
        return performance.now() - t0;
    });

    return median(runs) / (text.length / 1024);
}

/** One line, no breaks anywhere in it. */
const oneLine = (kb: number, unit: string): string => unit.repeat(Math.ceil((kb * 1024) / unit.length));

describe('lexing against line length', () => {
    it('costs the same per KB for a short line and a very long one', () => {
        const small = msPerKb(oneLine(16, 'word '), src => lexBlock(src, {} as never));
        const large = msPerKb(oneLine(256, 'word '), src => lexBlock(src, {} as never));

        expect(large / small, `block lexing: ${small.toFixed(3)} -> ${large.toFixed(3)} ms/KB`)
            .toBeLessThan(ALLOWANCE);
    });

    it('holds for the inline lexer, which does the per-character work', () => {
        const small = msPerKb(oneLine(16, 'word '), src => tokenizer(src));
        const large = msPerKb(oneLine(256, 'word '), src => tokenizer(src));

        expect(large / small, `inline lexing: ${small.toFixed(3)} -> ${large.toFixed(3)} ms/KB`)
            .toBeLessThan(ALLOWANCE);
    });

    it('holds for emphasis, code and strikethrough', () => {
    // Every one of these gives the inline rules somewhere to fail and retry,
    // which is where a quadratic hides. Links are excluded deliberately and
    // covered on their own below.
        const unit = '*a* _b_ `c` ~~d~~ ';
        const small = msPerKb(oneLine(8, unit), src => tokenizer(src));
        const large = msPerKb(oneLine(128, unit), src => tokenizer(src));

        expect(large / small, `marked-up inline: ${small.toFixed(3)} -> ${large.toFixed(3)} ms/KB`)
            .toBeLessThan(ALLOWANCE);
    });

    it('does not let links get any worse than they already are', () => {
    // 64 KB rather than the 128 KB the other cases use, and three runs rather
    // than five: at 8.6 ms/KB a 128 KB line of links costs 1.1 s to lex, and
    // five of those is a test that times out before it can assert anything.
    // That figure is the reason this test exists.
        const small = msPerKb(oneLine(8, '[d](e) '), src => tokenizer(src), 3);
        const large = msPerKb(oneLine(64, '[d](e) '), src => tokenizer(src), 3);

        // Not a licence — a ceiling on a known flaw, so that whoever rewrites the
        // link rule has a number to beat and nobody else can push it further.
        expect(large / small, `links: ${small.toFixed(3)} -> ${large.toFixed(3)} ms/KB`)
            .toBeLessThan(LINK_ALLOWANCE);
    }, 30_000);

    it('holds for a single enormous code fence', () => {
    // No inline lexing here — the fence's content is highlighted, not parsed —
    // so this covers the block lexer's own scan for the closing fence.
        const fenced = (kb: number): string => `\`\`\`\n${'x'.repeat(kb * 1024)}\n\`\`\`\n`;
        const small = msPerKb(fenced(16), src => lexBlock(src, {} as never));
        const large = msPerKb(fenced(256), src => lexBlock(src, {} as never));

        expect(large / small, `fenced block: ${small.toFixed(3)} -> ${large.toFixed(3)} ms/KB`)
            .toBeLessThan(ALLOWANCE);
    });
});
