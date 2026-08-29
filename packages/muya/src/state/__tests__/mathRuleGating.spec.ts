// `lexBlock` registers the math rules only when the document could match them,
// because an unmatchable rule still costs marked a `start()` scan of the whole
// remaining source at every token boundary — quadratic over a large file.
//
// The saving is real but the gate is a claim about the rules: get it wrong and
// math silently stops parsing rather than failing loudly. These cases pin the
// reasoning down.

import type { TState } from '../types';
import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';

const OPTIONS = {
    footnote: false,
    math: true,
    isGitlabCompatibilityEnabled: true,
    trimUnnecessaryCodeBlockEmptyLines: false,
    frontMatter: true,
};

function parse(markdown: string): TState[] {
    return new MarkdownToState(OPTIONS).generate(markdown);
}

function names(states: TState[]): string[] {
    return states.map(state => state.name);
}

describe('math rule gating', () => {
    it('parses block math that opens the document', () => {
        // No preceding newline, so the gate has to accept a leading `$`.
        const states = parse('$$\na + b\n$$\n');

        expect(names(states)).toContain('math-block');
    });

    it('parses block math further down the document', () => {
        const states = parse('Some text.\n\n$$\na + b\n$$\n');

        expect(names(states)).toContain('math-block');
    });

    it('keeps a paragraph intact when only the inline rule is registered', () => {
        // Contains `$` but never `\n$`, so the block rule is switched off. State
        // holds paragraph text raw — inline math is resolved later, at render
        // time — so what this pins down is that switching the block rule off
        // does not disturb the text around a `$`.
        const states = parse('Euler wrote $e^{i\\pi} + 1 = 0$ down.');

        expect(states).toHaveLength(1);
        expect(states[0]).toMatchObject({
            name: 'paragraph',
            text: 'Euler wrote $e^{i\\pi} + 1 = 0$ down.',
        });
    });

    it('leaves a document without any dollar sign alone', () => {
        const states = parse('# Title\n\nJust prose.\n');

        expect(names(states)).toEqual(['atx-heading', 'paragraph']);
    });
});
