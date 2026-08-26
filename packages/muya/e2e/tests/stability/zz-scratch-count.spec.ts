import { expect, test } from '../fixtures/muya';

test.describe('scratch: how often the selection is touched while rendering', () => {
    test.setTimeout(180_000);

    test('count addRange calls per document size', async ({ page }) => {
        const out = await page.evaluate(() => {
            const sizes = [10, 100, 400, 1200];
            const results: Array<Record<string, number>> = [];

            const proto = Selection.prototype as any;
            const originalAdd = proto.addRange;
            const originalRemove = proto.removeAllRanges;
            let calls = 0;
            let spent = 0;
            proto.addRange = function (...args: any[]) {
                const t0 = performance.now();
                const r = originalAdd.apply(this, args);
                spent += performance.now() - t0;
                calls++;
                return r;
            };

            for (const n of sizes) {
                const md = Array.from({ length: n }, (_, i) => `## Section ${i}\n\nProse ${i}.`).join('\n\n');
                window.__e2e!.rebuildMuya({ markdown: 'warm' });
                calls = 0;
                spent = 0;
                const t0 = performance.now();
                window.__e2e!.rebuildMuya({ markdown: md });
                const build = performance.now() - t0;
                results.push({ blocks: n * 2, calls, spent: Math.round(spent), build: Math.round(build) });
            }

            proto.addRange = originalAdd;
            proto.removeAllRanges = originalRemove;
            return results;
        });

        for (const r of out) {
            console.log(`COUNT blocks=${r.blocks} addRange=${r.calls} inAddRange=${r.spent}ms build=${r.build}ms`);
        }
        expect(out.length).toBeGreaterThan(0);
    });
});
