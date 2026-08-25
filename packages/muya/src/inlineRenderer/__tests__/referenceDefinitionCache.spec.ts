// @vitest-environment happy-dom

// Link reference definitions are collected once per document version, not once
// per painted block.
//
// `patch` runs for every content block, and it used to re-collect the
// definitions each time — deep-cloning and walking the whole document. Opening
// a document was O(blocks²): 400 sections of a three-item list is 15 KB of
// markdown and took over six seconds.
//
// Caching them is only correct if the cache is dropped when the document
// changes, which is the half worth testing: the speed is visible in a
// benchmark, a stale map is not — it silently renders links to the old target.

import { describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

function open(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();

    return muya;
}

describe('link reference definitions', () => {
    it('are available to the blocks that reference them', () => {
        const muya = open('[ref]: https://a.example\n\n[text][ref]\n');

        expect(muya.editor.inlineRenderer.labels.get('ref')?.href).toBe('https://a.example');
    });

    it('follow the document when it is replaced', () => {
        const muya = open('[ref]: https://a.example\n\n[text][ref]\n');
        expect(muya.editor.inlineRenderer.labels.get('ref')?.href).toBe('https://a.example');

        muya.setContent('[ref]: https://b.example\n\n[text][ref]\n');

        // Without invalidation this still reads a.example, and every reference
        // link in the document keeps pointing at the previous target.
        expect(muya.editor.inlineRenderer.labels.get('ref')?.href).toBe('https://b.example');
    });

    it('drop a definition that the new document no longer has', () => {
        const muya = open('[gone]: https://a.example\n\n[text][gone]\n');
        expect(muya.editor.inlineRenderer.labels.has('gone')).toBe(true);

        muya.setContent('Just a paragraph.\n');

        expect(muya.editor.inlineRenderer.labels.has('gone')).toBe(false);
    });
});
