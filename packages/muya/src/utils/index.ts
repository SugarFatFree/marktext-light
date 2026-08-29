import type { Diff } from 'fast-diff';
import type Content from '../block/base/content';
import type { Config } from './dompurify';
import { EVENT_KEYS } from '../config';
import runSanitize from './dompurify';

interface IUnion {
    start: number;
    end: number;
    active?: boolean;
}

// `never[]` in the contravariant arg-tuple position lets the @methodMixins
// decorator accept any concrete class constructor (`new (muya: Muya, …)`),
// without dragging the loosely-typed `any[]` back in.
type Constructor = new (...args: never[]) => object;

interface IDefer<T> {
    resolve: (value: T) => void;
    reject: (reason?: unknown) => void;
    promise: Promise<T>;
}

export function* uniqueIdGenerator() {
    let id = 0;

    while (true)
        yield id++;
}

const ID_PREFIX = 'mu-';
const uniqueIdIterator = uniqueIdGenerator();

export const getUniqueId = () => `${ID_PREFIX}${uniqueIdIterator.next().value}`;

export function getLongUniqueId() {
    return `${getUniqueId()}-${(Date.now()).toString(32)}`;
}

export function noop() {}

export const identity = <T>(i: T): T => i;

export const isOdd = (n: number) => Math.abs(n) % 2 === 1;

export const isEven = (n: number) => Math.abs(n) % 2 === 0;

export const isLengthEven = (str = '') => str.length % 2 === 0;

export function snakeToCamel(name: string) {
    return name.replace(/_([a-z])/g, (_p0, p1) => p1.toUpperCase());
}

// The fenced code block info string's first non-whitespace run is the
// "language" used for syntax highlighting and the `language-*` class
// (CommonMark §4.5). The rest of the info string is preserved as-is on the
// block so the fence round-trips.
export function firstWordOfInfo(info: string): string {
    return info.match(/\S*/)?.[0] ?? '';
}
/**
 *  Are two arrays have intersection
 */
export function conflict(arr1: [number, number], arr2: [number, number]) {
    return !(arr1[1] < arr2[0] || arr2[1] < arr1[0]);
}

export function union({ start: tStart, end: tEnd }: IUnion, { start: lStart, end: lEnd, active }: IUnion) {
    if (!(tEnd <= lStart || lEnd <= tStart)) {
        if (lStart < tStart) {
            return {
                start: tStart,
                end: tEnd < lEnd ? tEnd : lEnd,
                active,
            };
        }
        else {
            return {
                start: lStart,
                end: tEnd < lEnd ? tEnd : lEnd,
                active,
            };
        }
    }

    return null;
}

// https://github.com/jashkenas/underscore
// TODO: @jocs rewrite in the future.
export function throttle<TArgs extends unknown[], TReturn>(
    func: (...args: TArgs) => TReturn,
    wait = 50,
): (...args: TArgs) => TReturn | undefined {
    let context: unknown;
    let pendingArgs: TArgs | null = null;
    let result: TReturn | undefined;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let previous = 0;
    const later = () => {
        previous = Date.now();
        timeout = null;
        // `[]` is assignable to every concrete TArgs at runtime — the throttled
        // call site always supplies real args; the empty array only flows in
        // when there's nothing pending. TS rejects the single-cast form for an
        // unconstrained `TArgs extends unknown[]`; double-cast at the boundary.
        // eslint-disable-next-line no-restricted-syntax
        result = func.apply(context, pendingArgs ?? ([] as unknown as TArgs));
        if (!timeout) {
            context = null;
            pendingArgs = null;
        }
    };

    return function (this: unknown, ...callArgs: TArgs): TReturn | undefined {
        const now = Date.now();
        const remaining = wait - (now - previous);

        // eslint-disable-next-line ts/no-this-alias
        context = this;
        pendingArgs = callArgs;
        if (remaining <= 0 || remaining > wait) {
            if (timeout) {
                clearTimeout(timeout);
                timeout = null;
            }
            previous = now;
            result = func.apply(context, pendingArgs);
            if (!timeout) {
                context = null;
                pendingArgs = null;
            }
        }
        else if (!timeout) {
            timeout = setTimeout(later, remaining);
        }

        return result;
    };
}

export function deepClone<T>(value: T): T {
    return structuredClone(value);
}

export function escapeHTML(str: string) {
    return str.replace(
        /[&<>'"]/g,
        tag =>
            ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '\'': '&#39;',
                '"': '&quot;',
            }[tag] || tag),
    );
}

export function unescapeHTML(str: string) {
    return str.replace(
        /&amp;|&lt;|&gt;|&quot;|&#39;/g,
        tag =>
            ({
                '&amp;': '&',
                '&lt;': '<',
                '&gt;': '>',
                '&#39;': '\'',
                '&quot;': '"',
            }[tag] || tag),
    );
}

export function escapeInBlockHtml(html: string) {
    return html.replace(
        /(<(style|script|title)[^<>]*>)([\s\S]*?)(<\/\2>)/g,
        (_m, p1, _p2, p3, p4) => {
            return `${escapeHTML(p1)}${p3}${escapeHTML(p4)}`;
        },
    );
}

/**
 * The characters JavaScript's `\s` matches, by code point.
 *
 * Written out rather than tested with a regex: this runs once per character of
 * the document, and `/\s/.test(str[i])` allocates a one-character string and
 * enters the regex engine each time. Measured on 200 KB, that alone made a
 * single-pass count slower than the multi-pass one it replaced.
 */
function isWhitespace(code: number): boolean {
    if (code === 0x20 || (code >= 0x09 && code <= 0x0D))
        return true;
    if (code < 0xA0)
        return false;

    return code === 0xA0
        || code === 0x1680
        || (code >= 0x2000 && code <= 0x200A)
        || code === 0x2028
        || code === 0x2029
        || code === 0x202F
        || code === 0x205F
        || code === 0x3000
        || code === 0xFEFF;
}

const CJK_FIRST = 0x4E00;
const CJK_LAST = 0x9FA5;
const PARAGRAPH_BREAK = /\n{2,}/g;

/**
 * Word, character and paragraph counts for the status bar.
 *
 * Counted in one pass, without building the intermediate strings and arrays the
 * definition suggests. It used to copy the document with the CJK removed, split
 * that into every whitespace-separated token — tens of thousands of strings for
 * a large file — filter the array, then reduce it. The desktop calls this on
 * every keystroke, over the whole document.
 *
 * The definitions are unchanged and pinned by a differential test against the
 * original implementation:
 *   - a CJK character counts as its own word, and does NOT break the token
 *     around it (the old code deleted those characters and split what was left,
 *     so `ab<CJK>cd` was one token)
 *   - `character` counts non-whitespace only, CJK included
 *   - `paragraph` counts the non-empty runs between blank lines
 */
export function wordCount(markdown: string) {
    let cjk = 0;
    let tokens = 0;
    let characters = 0;
    let inToken = false;

    for (let i = 0; i < markdown.length; i++) {
        const code = markdown.charCodeAt(i);
        if (code >= CJK_FIRST && code <= CJK_LAST) {
            cjk++;
            continue;
        }
        if (isWhitespace(code)) {
            inToken = false;
            continue;
        }
        characters++;
        if (!inToken) {
            inToken = true;
            tokens++;
        }
    }

    return {
        word: cjk + tokens,
        paragraph: countParagraphs(markdown),
        character: characters + cjk,
        all: markdown.length,
    };
}

/**
 * Non-empty runs between blank lines, i.e. `split(/\n{2,}/).filter(Boolean).length`
 * without materialising the pieces. Splitting on N separators yields N+1 pieces,
 * and a piece is empty only where the document opens or closes with one.
 */
function countParagraphs(markdown: string): number {
    if (markdown.length === 0)
        return 0;

    PARAGRAPH_BREAK.lastIndex = 0;
    let separators = 0;
    let match = PARAGRAPH_BREAK.exec(markdown);
    let opensWithBreak = false;
    let lastEnd = -1;
    while (match !== null) {
        if (match.index === 0)
            opensWithBreak = true;
        lastEnd = match.index + match[0].length;
        separators++;
        match = PARAGRAPH_BREAK.exec(markdown);
    }

    const closesWithBreak = lastEnd === markdown.length;

    return separators + 1 - (opensWithBreak ? 1 : 0) - (closesWithBreak ? 1 : 0);
}

export function sanitize(html: string, purifyOptions: Config, disableHtml: boolean) {
    if (disableHtml)
        return runSanitize(escapeHTML(html), purifyOptions);
    else
        return runSanitize(escapeInBlockHtml(html), purifyOptions);
}

/**
 * TODO: @jocs remove in the future, because it's not used.
 * @param ele
 * @param id
 * @returns A floating-ui-compatible virtual reference positioned at the element's bounding rect.
 */
export function getParagraphReference(ele: HTMLElement, id: string) {
    const { x, y, left, top, bottom, height } = ele.getBoundingClientRect();

    return {
        getBoundingClientRect() {
            return { x, y, left, top, bottom, height, width: 0, right: left };
        },
        clientWidth: 0,
        clientHeight: height,
        id,
    };
}

function visibleLength(str: string) {
    return [...new Intl.Segmenter().segment(str)].length;
}

export type TDiff = (string | number | { d: string });

/**
 * transform diff to text-unicode op
 * @param {Array} diffs
 */
export function diffToTextOp(diffs: Diff[]) {
    const op: TDiff[] = [];

    for (const diff of diffs) {
        switch (diff[0]) {
            case -1:
                op.push({ d: diff[1] });
                break;

            case 0:
                op.push(visibleLength(diff[1]));
                break;

            case 1:
                op.push(diff[1]);
                break;

            default:
                break;
        }
    }

    let peak = op[op.length - 1];
    while (typeof peak === 'number') {
        op.pop();
        peak = op[op.length - 1];
    }

    return op;
}

// If the next block is header, put cursor after the `#{1,6} *`
export function adjustOffset<T extends Content>(offset: number, block: T, event: KeyboardEvent) {
    if (
        block.parent?.blockName === 'atx-heading'
        && event.key === EVENT_KEYS.ArrowDown
    ) {
        const match = /^\s{0,3}#{1,6}(?:\s+|$)/.exec(block.text);
        if (match)
            return match[0].length;
    }

    return offset;
}

export function verticalPositionInRect(event: MouseEvent, rect: DOMRect) {
    const { clientY } = event;
    const { top, height } = rect;

    return clientY - top > height / 2 ? 'down' : 'up';
}

// `hasPick` is called by editor.updateContents on each element of an
// ot-json1 op descent. The element shape is one of (number | string |
// JSONOpComponent | JSONOpList) — only the component case (`{p?, r?, ...}`)
// is interesting. Accept the structural subset we actually read instead of
// dragging in the whole union (most callers pass an already-narrowed
// object).
export function hasPick(c: { p?: number; r?: unknown } | null | undefined): boolean {
    return !!c && (c.p != null || c.r !== undefined);
}

export function getDefer<T>() {
    const defer: IDefer<T> = {} as IDefer<T>;
    const promise = new Promise<T>((resolve, reject) => {
        defer.resolve = resolve;
        defer.reject = reject;
    });
    defer.promise = promise;

    return defer;
}

export function methodMixins(
    // `never[]` in the arg-tuple position (contravariant) accepts any
    // function shape — the inlineSyntaxRenderer mixin map has methods with
    // wildly different signatures (`backlashInToken`, `header`, `link`…).
    ...objects: Record<string, (...args: never[]) => unknown>[]
) {
    return (constructor: Constructor) => {
        for (const object of objects) {
            Object.keys(object).forEach((name) => {
                Object.defineProperty(
                    constructor.prototype,
                    name,
                    Object.getOwnPropertyDescriptor(object, name) || Object.create(null),
                );
            });
        }
    };
}

export function mixins(...constructors: Constructor[]) {
    return (derivedCtor: Constructor) => {
        constructors.forEach((baseCtor) => {
            Object.getOwnPropertyNames(baseCtor.prototype).forEach((name) => {
                // Do not rewrite the constructor of derivedCtor.
                if (name === 'constructor')
                    return;

                Object.defineProperty(
                    derivedCtor.prototype,
                    name,
                    Object.getOwnPropertyDescriptor(baseCtor.prototype, name)
                    || Object.create(null),
                );
            });
        });
    };
}

// narrowing Event type to KeyboardEvent.
export function isKeyboardEvent(event: Event): event is KeyboardEvent {
    return 'key' in event;
}

// narrowing Event type to MouseEvent.
export function isMouseEvent(event: Event): event is MouseEvent {
    return 'x' in event;
}

export function isInputEvent(event: Event): event is InputEvent {
    return 'inputType' in event;
}

// narrowing Note type to Element.
export function isElement(node: Node): node is Element {
    return node.nodeType === Node.ELEMENT_NODE;
}

export function isClipboardEvent(event: Event): event is ClipboardEvent {
    return 'clipboardData' in event;
}

export function isHTMLElement(value: unknown): value is HTMLElement {
    return value instanceof HTMLElement;
}

export function isHTMLInputElement(value: unknown): value is HTMLInputElement {
    return value instanceof HTMLInputElement;
}

export function isHTMLTextAreaElement(value: unknown): value is HTMLTextAreaElement {
    return value instanceof HTMLTextAreaElement;
}

export function isHTMLAnchorElement(value: unknown): value is HTMLAnchorElement {
    return value instanceof HTMLAnchorElement;
}
