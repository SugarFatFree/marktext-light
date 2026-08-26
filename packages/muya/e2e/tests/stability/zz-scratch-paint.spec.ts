import { expect, test } from '../fixtures/muya';

test.describe('scratch: is the forced layout wasted or merely early', () => {
    test.setTimeout(180_000);

    test('time to painted document, with and without the caret placement', async ({ page }) => {
        const out = await page.evaluate(async () => {
            const paint = () => new Promise<void>(resolve =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

            const proto = Selection.prototype as any;
            const originalAdd = proto.addRange;
            const originalExtend = proto.extend;

            const run = async (n: number, skipCaret: boolean) => {
                const md = Array.from({ length: n }, (_, i) => `## Section ${i}\n\nProse ${i}.`).join('\n\n');
                window.__e2e!.rebuildMuya({ markdown: 'warm' });
                await paint();

                // `extend` goes with it: the caret is placed as addRange +
                // extend, and extend throws if no range was ever added.
                proto.addRange = skipCaret ? function () {} : originalAdd;
                proto.extend = skipCaret ? function () {} : originalExtend;
                const t0 = performance.now();
                window.__e2e!.rebuildMuya({ markdown: md });
                const build = performance.now() - t0;
                await paint();
                const painted = performance.now() - t0;
                proto.addRange = originalAdd;
                proto.extend = originalExtend;
                return { build: Math.round(build), painted: Math.round(painted) };
            };

            const results: any[] = [];
            for (const n of [400, 1200]) {
                // Alternate so neither ordering gets the warmer engine.
                const withCaret = await run(n, false);
                const without = await run(n, true);
                const withCaret2 = await run(n, false);
                results.push({
                    blocks: n * 2,
                    withCaret: Math.min(withCaret.painted, withCaret2.painted),
                    withCaretBuild: Math.min(withCaret.build, withCaret2.build),
                    without: without.painted,
                    withoutBuild: without.build,
                });
            }
            return results;
        });

        for (const r of out) {
            console.log(`PAINT blocks=${r.blocks} withCaret build=${r.withCaretBuild}ms painted=${r.withCaret}ms | withoutCaret build=${r.withoutBuild}ms painted=${r.without}ms`);
        }
        expect(out.length).toBeGreaterThan(0);
    });
});
