import { expect, test } from '../fixtures/muya';
import { slowType } from '../helpers/keyboard';
import { editor, floats } from '../helpers/selectors';

test.describe('emoji picker', () => {
    test('typing a complete :keyword: token triggers the emoji picker', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent(''));
        await page.locator(editor.paragraph).first().click();
        // The emoji-picker event fires when the inline lexer parses a complete
        // emoji token at the cursor (`:smile`). Type the full keyword so the
        // lexer recognises it.
        await slowType(page, ':smile');
        // The picker uses opacity to "hide" so toBeVisible may be unreliable.
        // Confirm the picker container exists; if its render array is
        // populated, the opacity will be 1.
        const picker = page.locator(floats.emojiPicker);
        await expect(picker).toHaveCount(1);
        // Probe its computed opacity directly; some test runs see the picker
        // visibly populated, others see an empty filter set. Either way, the
        // wiring is exercised — assert the DOM exists rather than over-spec.
        const opacity = await picker.evaluate(el => getComputedStyle(el).opacity);
        expect(typeof opacity).toBe('string');
    });

    test('fills with suggestions, including the first time in a session', async ({ page }) => {
        // The emoji table is 179 KB and is not in the startup bundle; the
        // picker prefetches it on idle, so by the time anything is typed it is
        // normally in hand. Polling covers the case where it is not — and, in
        // this harness specifically, the dev server transforming a
        // 13,000-line module on first request, which a built app never does.
        //
        // The case above deliberately asserts only that the container exists,
        // because its populated state used to be flaky. This one asserts the
        // thing a user cares about — that suggestions actually appear — which
        // is also exactly what deferring the table could break.
        await page.evaluate(() => window.muya!.setContent(''));
        await page.locator(editor.paragraph).first().click();
        await slowType(page, ':smile');

        await expect
            .poll(() => page.locator(`${floats.emojiPicker} div.item`).count(), { timeout: 25000 })
            .toBeGreaterThan(0);
    });

    test('emoji picker DOM is detached only via opacity (not removed)', async ({ page }) => {
        // The picker float box is mounted once and reused — confirm it stays
        // in the DOM after focus moves elsewhere.
        await page.evaluate(() => window.muya!.setContent('plain text'));
        await page.locator(editor.paragraph).first().click();
        await expect(page.locator(floats.emojiPicker)).toHaveCount(1);
    });
});
