// The alias map is generated from the emoji table, and this keeps them equal.
//
// `validEmoji` reads the map while tokenizing and rendering `:alias:`, both
// synchronously. The full table — descriptions, categories, search tags — is
// 179 KB and only the picker uses it, so it loads on demand and the map is what
// the parse path gets.
//
// Two files holding the same facts drift. This derives the map from the table
// and compares, so a regenerated table with no regenerated map fails here
// rather than by quietly failing to recognise `:some_new_alias:`.

import { describe, expect, it } from 'vitest';
import emojiByAlias from '../emojiAliases';
import emojis from '../emojis';

describe('the emoji alias map', () => {
    it('matches the table it was generated from', () => {
        const expected: Record<string, string> = {};
        for (const emoji of emojis) {
            for (const alias of emoji.aliases) {
                // First alias wins, which is what `find` over the table did.
                if (!(alias in expected))
                    expected[alias] = emoji.emoji;
            }
        }

        expect(emojiByAlias).toEqual(expected);
    });

    it('is much smaller than the table, which is the point', () => {
        // Not a size assertion — a shape one. The map holds a string per alias;
        // the table holds an object with a description, a category and tags.
        const [firstAlias] = Object.keys(emojiByAlias);

        expect(typeof emojiByAlias[firstAlias!]).toBe('string');
        expect(Object.keys(emojis[0]!).sort()).toContain('tags');
    });

    it('resolves an alias the parse path relies on', () => {
        expect(emojiByAlias.smile).toBe(emojis.find(e => e.aliases.includes('smile'))!.emoji);
    });
});
