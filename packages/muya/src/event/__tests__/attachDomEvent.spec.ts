// @vitest-environment happy-dom

// `attachDOMEvent` refuses a binding it already holds. That check reads an
// index rather than walking every binding on the instance, because the walk was
// once per bind over a table that grows with the document — one entry per block
// on a large file, so the binding pass was quadratic.
//
// An index can go stale where a scan cannot, and the way it shows is silence:
// the bind returns as though it had succeeded and the listener never fires.
// These pin both directions — a duplicate is still refused, and anything that
// is not a duplicate still binds.

import { describe, expect, it, vi } from 'vitest';
import EventCenter from '../index';

describe('attachDOMEvent duplicate suppression', () => {
    const makeTarget = (): HTMLElement => document.createElement('div');

    it('binds once when the same listener is attached twice', () => {
        const ec = new EventCenter();
        const target = makeTarget();
        const fn = vi.fn();

        const first = ec.attachDOMEvent(target, 'click', fn);
        const second = ec.attachDOMEvent(target, 'click', fn);
        target.dispatchEvent(new Event('click'));

        expect(first).not.toBe('');
        expect(second).toBe('');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('binds again after the first binding is detached', () => {
        const ec = new EventCenter();
        const target = makeTarget();
        const fn = vi.fn();

        ec.detachDOMEvent(ec.attachDOMEvent(target, 'click', fn));
        const again = ec.attachDOMEvent(target, 'click', fn);
        target.dispatchEvent(new Event('click'));

        expect(again).not.toBe('');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('binds again after every binding is detached', () => {
        const ec = new EventCenter();
        const target = makeTarget();
        const fn = vi.fn();

        ec.attachDOMEvent(target, 'click', fn);
        ec.detachAllDomEvents();
        const again = ec.attachDOMEvent(target, 'click', fn);
        target.dispatchEvent(new Event('click'));

        expect(again).not.toBe('');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('treats the same listener on different events as different bindings', () => {
        const ec = new EventCenter();
        const target = makeTarget();
        const fn = vi.fn();

        ec.attachDOMEvent(target, 'click', fn);
        const other = ec.attachDOMEvent(target, 'focus', fn);
        target.dispatchEvent(new Event('click'));
        target.dispatchEvent(new Event('focus'));

        expect(other).not.toBe('');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('treats the same listener on different targets as different bindings', () => {
        const ec = new EventCenter();
        const one = makeTarget();
        const two = makeTarget();
        const fn = vi.fn();

        ec.attachDOMEvent(one, 'click', fn);
        const second = ec.attachDOMEvent(two, 'click', fn);
        one.dispatchEvent(new Event('click'));
        two.dispatchEvent(new Event('click'));

        expect(second).not.toBe('');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('keeps capture variants apart', () => {
        // The check compares `capture` with `===`, so a listener registered for
        // the capture phase and the same one for the bubble phase are two
        // bindings, and the browser fires both.
        const ec = new EventCenter();
        const target = makeTarget();
        const fn = vi.fn();

        ec.attachDOMEvent(target, 'click', fn, true);
        const bubbling = ec.attachDOMEvent(target, 'click', fn, false);
        target.dispatchEvent(new Event('click'));

        expect(bubbling).not.toBe('');
        expect(fn).toHaveBeenCalledTimes(2);
    });
});
