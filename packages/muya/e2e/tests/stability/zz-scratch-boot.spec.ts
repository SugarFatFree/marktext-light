import { expect, test } from '../fixtures/muya';

test.describe('scratch: engine construction cost', () => {
    test.setTimeout(120_000);

    test('construct + init for realistic documents', async ({ page }) => {
        const sizes = [
            ['tiny (1 heading + 1 para)', '# Title\n\nOne paragraph.\n'],
            ['readme-ish (~6 KB)', Array.from({ length: 60 }, (_, i) => `## Section ${i}\n\nSome prose with \`code\` and a [link](https://example.com).`).join('\n\n')],
            ['big (~120 KB)', Array.from({ length: 1200 }, (_, i) => `## Section ${i}\n\nSome prose with \`code\` and a [link](https://example.com).`).join('\n\n')],
        ] as const;

        for (const [label, markdown] of sizes) {
            const ms = await page.evaluate((md) => {
                // Warm once so the measurement is construction, not first-touch
                // of lazily initialised module state.
                window.__e2e!.rebuildMuya({ markdown: 'warm' });
                const t0 = performance.now();
                window.__e2e!.rebuildMuya({ markdown: md });
                return performance.now() - t0;
            }, markdown);
            console.log(`BOOT ${label}: ${ms.toFixed(1)} ms (${markdown.length} bytes)`);
        }

        expect(true).toBe(true);
    });
});
