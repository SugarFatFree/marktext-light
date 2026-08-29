// @vitest-environment happy-dom

// `getMarkdown()` serializes the live state instead of a copy of it.
//
// The desktop asks for the markdown on every `json-change` — every keystroke —
// to drive its save/dirty state. Taking `getState()` first meant a full
// structured clone of the document each time, purely so a read-only serializer
// could read it.
//
// That is only safe while the serializer stays read-only, which is not
// something a reader of `StateToMarkdown` can keep verifying by eye across 600
// lines. So it is asserted: serialize, and the document must be exactly as it
// was, including through the paths with the most bookkeeping — nested lists,
// tables, blockquotes and front matter.

import type Content from '../../block/base/content';
import { describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

const RICH = `---
title: Front matter
---

# Heading

A paragraph with **bold**, *italic*, \`code\` and a [link](https://example.com).

- loose item

  nested paragraph

  1. ordered child
  2. another
- [ ] task
- [x] done

> quoted
> across lines

| a | b |
| --- | --- |
| 1 | 2 |

\`\`\`js
const x = 1
\`\`\`
`;

function open(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();

    return muya;
}

describe('getMarkdown', () => {
    it('leaves the state untouched', () => {
        const muya = open(RICH);
        const before = JSON.stringify(muya.getState());

        muya.getMarkdown();

        expect(JSON.stringify(muya.getState())).toBe(before);
    });

    it('is stable when called repeatedly', () => {
        // A serializer that mutated as it went would usually show up as a
        // second call disagreeing with the first.
        const muya = open(RICH);

        const once = muya.getMarkdown();
        const twice = muya.getMarkdown();
        const thrice = muya.getMarkdown();

        expect(twice).toBe(once);
        expect(thrice).toBe(once);
    });

    it('still round-trips an edit', () => {
        const muya = open('hello\n');
        const leaf = muya.editor.scrollPage!.firstContentInDescendant() as Content;

        leaf.text = 'hello world';
        muya.flush();

        expect(muya.getMarkdown().trim()).toBe('hello world');
    });
});
