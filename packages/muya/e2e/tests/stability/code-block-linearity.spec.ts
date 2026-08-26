import { expect, test } from '../fixtures/muya';

/**
 * Opening a document of code blocks must cost in proportion to its size.
 *
 * It did not. The line-number gutter measured each line's position and wrote
 * it back in the same loop, so every line forced a fresh layout of the whole
 * document; batching the gutters of all blocks into one frame took a 68 KB
 * file from 3007 ms to 675. The cost per KB went from rising with size —
 * 16.6, 17.7, 23.6 across a 4x range — to flat.
 *
 * The unit tests that came with those fixes pin the shape of the code: reads
 * before writes, and one batch per frame. Neither would notice the quadratic
 * returning by another route, which is what this is for. It asserts the
 * property rather than the implementation, and asserts a slope rather than a
 * duration, so a slow runner moves both measurements together.
 */
test.describe('code blocks against document size', () => {
    test.setTimeout(180_000);

    const SMALL = 220;
    const LARGE = 880;

    const doc = (blocks: number): string => Array.from(
        { length: blocks },
        (_, i) => `## Section ${i}\n\n\`\`\`\nconst x${i} = ${i};\nfunction f${i}() { return x${i} + 1; }\n\`\`\``,
    ).join('\n\n');

    test('costs the same per KB whether there are few blocks or many', async ({ page }) => {
        const client = await page.context().newCDPSession(page);

        const open = async (markdown: string): Promise<number> => page.evaluate(async (md) => {
            const t0 = performance.now();
            window.__e2e!.rebuildMuya({ markdown: md });
            // Two frames: the gutter batch runs on the first, so waiting for
            // the second is waiting for the work this measures.
            await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
            return performance.now() - t0;
        }, markdown);

        /** Median of three. A single run on a shared machine catches a GC
         *  pause as often as it catches a regression. */
        const costPerKb = async (blocks: number): Promise<number> => {
            const markdown = doc(blocks);
            const runs: number[] = [];
            for (let i = 0; i < 3; i++) {
                runs.push(await open(markdown));
                // Discarded documents pile up fast at this size.
                await client.send('HeapProfiler.collectGarbage');
            }
            const median = [...runs].sort((a, b) => a - b)[1]!;

            return median / (markdown.length / 1024);
        };

        await page.evaluate(() => window.__e2e!.rebuildMuya({ markdown: '# warm\n\ntext' }));

        const small = await costPerKb(SMALL);
        const large = await costPerKb(LARGE);

        console.log(
            `code blocks: ${SMALL} blocks ${small.toFixed(2)} ms/KB · `
            + `${LARGE} blocks ${large.toFixed(2)} ms/KB`,
        );

        expect(small, 'the small document cost nothing measurable').toBeGreaterThan(0);
        // Four times the document must not cost more per KB. The margin covers
        // run-to-run spread; the quadratic this guards against showed 1.43x
        // over this range, so it would still be caught.
        expect(
            large,
            `${LARGE} blocks cost ${large.toFixed(2)} ms/KB against ${small.toFixed(2)} for ${SMALL} — `
            + 'opening code blocks is growing faster than the document',
        ).toBeLessThan(small * 1.35);
    });
});
