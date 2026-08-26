// `lexBlock` registers the footnote rule only when the document could match it,
// for the reason the math rules are gated the same way: an unmatchable rule
// still costs marked a `start()` scan of the whole remaining source at every
// token boundary, which is quadratic over a large file. Measured on a 593 KB
// document with no footnotes, opening it went from 6.0 s to 4.5 s, and the cost
// per KB stopped climbing with size.
//
// The gate is a claim about the rule — that nothing it matches can lack a
// literal `[^`. Get it wrong and footnotes silently stop parsing rather than
// failing loudly, so the claim is pinned here rather than trusted.

import type { TState } from '../types';
import { describe, expect, it } from 'vitest';
import { MarkdownToState } from '../markdownToState';

const OPTIONS = {
    footnote: true,
    math: false,
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

describe('footnote rule gating', () => {
    it('parses a definition that opens the document', () => {
        // No preceding newline, so the gate has to accept a leading `[^`.
        const states = parse('[^1]: A note.\n');

        expect(names(states)).toContain('footnote');
    });

    it('parses a definition further down the document', () => {
        const states = parse('Some text.\n\n[^1]: A note.\n');

        expect(names(states)).toContain('footnote');
    });

    it('parses a definition that follows front matter', () => {
        // Front matter is stripped after the gate has looked at the source, so
        // the gate reads a superset of what the lexer sees. Nothing is lost by
        // that, but a document whose only `[^` sits past the front matter is
        // where it would show.
        const states = parse('---\ntitle: t\n---\n\n[^1]: A note.\n');

        expect(names(states)).toContain('footnote');
    });

    it('leaves a reference without a definition as text', () => {
        // Contains `[^`, so the rule is registered and this is the behaviour it
        // has always had — inline refs resolve at render time, not here.
        const states = parse('A ref[^1] with no definition.');

        expect(states).toHaveLength(1);
        expect(states[0]).toMatchObject({
            name: 'paragraph',
            text: 'A ref[^1] with no definition.',
        });
    });

    it('leaves a document without any bracket-caret alone', () => {
        const states = parse('# Title\n\nJust prose.\n');

        expect(names(states)).toEqual(['atx-heading', 'paragraph']);
    });
});
