// `wordCount` counts in one pass now. This holds the new implementation to the
// old one's answers, on the inputs where they could differ.
//
// The original built the intermediate strings the definition implies — the
// document with CJK deleted, then every whitespace-separated token in it, as an
// array — and the desktop calls this on every keystroke over the whole file.
// The counting rules are unchanged, and some of them are surprising enough to
// be worth stating: deleting the CJK characters before splitting means a CJK
// character does not break the token around it, so `ab<CJK>cd` was, and is, one
// token.

import { describe, expect, it } from 'vitest';
import { wordCount } from '..';

/** The implementation this replaces, kept verbatim as the oracle. */
function original(markdown: string) {
    const paragraph = markdown.split(/\n{2,}/).filter(line => line).length;
    let word = 0;
    let character = 0;
    let all = 0;

    const removedChinese = markdown.replace(/[\u4E00-\u9FA5]/g, '');
    const tokens = removedChinese.split(/\s+/).filter(t => t);
    const chineseWordLength = markdown.length - removedChinese.length;
    word += chineseWordLength + tokens.length;
    character += tokens.reduce((acc, t) => acc + t.length, 0) + chineseWordLength;
    all += markdown.length;

    return { word, paragraph, character, all };
}

const CASES: string[] = [
    '',
    ' ',
    '\n',
    '\n\n',
    '\n\n\n\n',
    'word',
    'two words',
    '  leading and trailing  ',
    'a\n\nb',
    '\n\na\n\nb\n\n',
    'a\n\n\n\nb',
    'line\nline\nline',
    'tabs\tand\tspaces',
    '中文',
    '中文 English 混排',
    'ab中cd',
    '中\n\n文',
    '# Heading\n\nParagraph with **bold** and `code`.\n\n- a\n- b\n',
    '---\ntitle: front matter\n---\n\nBody\n',
    'trailing newlines\n\n\n',
    '\r\n\r\nwindows\r\n\r\n',
    'emoji 🙂 and combining é',
    'a'.repeat(500),
    `${'word '.repeat(200)}\n\n${'中'.repeat(50)}`,
];

describe('wordCount', () => {
    it('agrees with the implementation it replaced', () => {
        for (const input of CASES)
            expect(wordCount(input), JSON.stringify(input.slice(0, 40))).toEqual(original(input));
    });

    it('agrees on generated documents too', () => {
        const pieces = ['word', ' ', '\n', '\n\n', '中', '\t', '.', 'aa', '', '\r\n'];
        // Deterministic rather than random: a failing case has to be
        // reproducible from the file alone.
        let seed = 1;
        const next = (): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed;
        };
        for (let round = 0; round < 300; round++) {
            let input = '';
            const length = next() % 40;
            for (let i = 0; i < length; i++)
                input += pieces[next() % pieces.length];

            expect(wordCount(input), JSON.stringify(input.slice(0, 60))).toEqual(original(input));
        }
    });

    it('counts a CJK character as a word without breaking its neighbours', () => {
        // Stated because it reads like a bug and is deliberate: the old code
        // removed CJK before splitting, so the surrounding letters stayed joined.
        expect(wordCount('ab中cd')).toEqual({ word: 2, paragraph: 1, character: 5, all: 5 });
    });
});
