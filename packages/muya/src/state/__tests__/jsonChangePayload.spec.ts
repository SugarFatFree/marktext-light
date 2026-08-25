// @vitest-environment happy-dom

// What `json-change` carries, and what it deliberately does not.
//
// `dispatch` copies the whole document to build `prevDoc`, on every edit, which
// means on every keystroke. History needs it — the inverse operation for undo
// is computed against the document as it was.
//
// It used to copy the document a second time, after the operation, and emit
// that as `doc`. Nothing read it, in muya or in the desktop app that consumes
// it: the listener here destructures `op`, `source` and `prevDoc`, and the
// renderer's handler ignores the payload entirely. A CPU profile of typing in a
// real window put `deepClone` at 6.2% of samples; half of that was for a value
// with no reader.

import type Content from '../../block/base/content';
import { describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

function open(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();

    return muya;
}

describe('the json-change payload', () => {
    it('carries the document as it was, for undo', () => {
        const muya = open('# Heading\n\nA paragraph.\n');
        const seen: Array<Record<string, unknown>> = [];
        muya.eventCenter.on('json-change', (payload: unknown) => {
            seen.push(payload as Record<string, unknown>);
        });

        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.text = 'Heading edited';
        muya.flush();

        expect(seen.length).toBeGreaterThan(0);
        expect(Array.isArray(seen[0]!.prevDoc)).toBe(true);
        expect(seen[0]).toHaveProperty('op');
        expect(seen[0]).toHaveProperty('source');
    });

    it('does not also carry the document as it now is', () => {
        const muya = open('# Heading\n\nA paragraph.\n');
        const seen: Array<Record<string, unknown>> = [];
        muya.eventCenter.on('json-change', (payload: unknown) => {
            seen.push(payload as Record<string, unknown>);
        });

        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;
        leaf.text = 'Heading edited again';
        muya.flush();

        expect(seen.length).toBeGreaterThan(0);
        for (const payload of seen)
            expect(Object.keys(payload)).not.toContain('doc');
    });
});
