import type { Emoji as EmojiType } from '../../config/emojis';
import Fuse from 'fuse.js';

/**
 * The full emoji table, loaded when the picker first searches.
 *
 * It is 179 KB of the first-paint bundle — the largest single thing muya
 * contributes — and only this popup reads the descriptions, categories and
 * tags. Parsing `:alias:` uses the much smaller alias map instead, so a session
 * that never opens the picker never pays for this.
 *
 * `search` stays synchronous and returns nothing until the table lands; the
 * caller re-renders when `whenReady` resolves.
 */
let emojisForSearch: Record<string, EmojiType[]> | null = null;
let loading: Promise<void> | null = null;

function loadEmojis(): Promise<void> {
    if (loading)
        return loading;

    loading = import('../../config/emojis').then(({ default: emojis }) => {
        const grouped: Record<string, EmojiType[]> = {};
        for (const emoji of emojis) {
            if (grouped[emoji.category])
                grouped[emoji.category].push(emoji);
            else
                grouped[emoji.category] = [emoji];
        }
        emojisForSearch = grouped;
    });

    return loading;
}

class Emoji {
    // cache key is the search text, and the value is search results by category.
    private _cache: Map<string, Record<string, EmojiType[]>> = new Map();

    /** Resolves once the table is in hand; callers re-render then. */
    whenReady(): Promise<void> {
        return loadEmojis();
    }

    search(text: string): Record<string, EmojiType[]> {
        const { _cache: cache } = this;
        if (cache.has(text))
            return cache.get(text)!;

        const table = emojisForSearch;
        if (!table) {
            // Not loaded yet. Return empty WITHOUT caching, so the first real
            // results are not shadowed by this placeholder answer.
            void loadEmojis();

            return {};
        }

        const result: Record<string, EmojiType[]> = {};

        Object.keys(table).forEach((category) => {
            const fuse = new Fuse(table[category], {
                includeScore: true,
                keys: ['aliases', 'tags'],
            });
            const list = fuse.search(text).map(i => i.item);
            if (list.length)
                result[category] = list;
        });
        cache.set(text, result);

        return result;
    }

    destroy() {
        return this._cache.clear();
    }
}

export default Emoji;
