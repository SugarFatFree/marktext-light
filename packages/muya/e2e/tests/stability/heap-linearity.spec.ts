import { expect, test } from '../fixtures/muya';

/**
 * A loaded document must cost memory in proportion to its size.
 *
 * The desktop suite already pins a ceiling, but at a single document size —
 * which a per-block cost that grows with the document would slip straight
 * past, since one point cannot show a slope. Two sizes can: if the bytes each
 * block retains is the same at both, the cost is linear, and the ceiling
 * elsewhere keeps meaning what it says at sizes nobody measured.
 *
 * Measured over 8000-16000 sections while writing this: 956-970 bytes a block,
 * flat, or about 25x the source markdown. The two sizes here are the smallest
 * that still put the growth well clear of the noise on the blank reading.
 */
test.describe('memory against document size', () => {
    test.setTimeout(120_000);

    const SMALL = 3000;
    const LARGE = 6000;

    // Two blocks a section: the heading and the paragraph under it.
    const BLOCKS_PER_SECTION = 2;

    const doc = (sections: number): string => Array.from(
        { length: sections },
        (_, i) => `## Section ${i}\n\nSome prose with \`code\` and a [link](https://example.com).`,
    ).join('\n\n');

    test('costs the same per block whether the document is small or large', async ({ page }) => {
        const client = await page.context().newCDPSession(page);

        const heapHolding = async (markdown: string): Promise<number> => {
            await page.evaluate(async (md) => {
                window.__e2e!.rebuildMuya({ markdown: md });
                // Two frames: the second only runs once the first has painted,
                // so everything the render allocates is on the heap by now.
                await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
            }, markdown);
            // Twice, because the first pass frees objects that were only
            // reachable from what the first pass collected.
            await client.send('HeapProfiler.collectGarbage');
            await client.send('HeapProfiler.collectGarbage');
            const { usedSize } = await client.send('Runtime.getHeapUsage');
            return usedSize;
        };

        const blank = await heapHolding('');
        const small = await heapHolding(doc(SMALL));
        const large = await heapHolding(doc(LARGE));

        const perBlock = (used: number, sections: number): number =>
            (used - blank) / (sections * BLOCKS_PER_SECTION);
        const smallCost = perBlock(small, SMALL);
        const largeCost = perBlock(large, LARGE);

        console.log(
            `heap: blank ${(blank / 1048576).toFixed(1)} MB · `
            + `${SMALL} sections ${(small / 1048576).toFixed(1)} MB (${smallCost.toFixed(0)} B/block) · `
            + `${LARGE} sections ${(large / 1048576).toFixed(1)} MB (${largeCost.toFixed(0)} B/block)`,
        );

        expect(smallCost, 'the small document retained nothing measurable').toBeGreaterThan(0);
        // Doubling the document must not raise what a block costs. The margin
        // absorbs GC variance on the blank reading, and is far below the 2x a
        // per-document copy retained per block would show.
        expect(
            largeCost,
            `a block costs ${largeCost.toFixed(0)} B in the large document against `
            + `${smallCost.toFixed(0)} B in the small one — memory is growing faster than the document`,
        ).toBeLessThan(smallCost * 1.4);
    });
});
