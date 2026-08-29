// Visible line count for a code block, matching marktext `a028a7c2`:
//   - each `\n` adds a row
//   - a trailing `\n` still counts as the next visible (empty) row in
//     contenteditable, which falls out naturally from "count + 1"
//
// Implemented with a charCode loop (no regex match array allocation —
// this is called on every code-block update, including large pasted blobs).
const LF = 10;

export function computeLineCount(text: string): number {
    let count = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === LF)
            count++;
    }
    return count;
}

export const LINE_NUMBERS_ROWS_CLASS = 'mu-line-numbers-rows';

// The wrapper starts empty; CodeBlockContent.update() syncs spans on demand
// via `syncLineNumbersSpans` (delta updates, no full innerHTML rewrite).
export function lineNumbersWrapperHTML(): string {
    return `<span class="${LINE_NUMBERS_ROWS_CLASS}" contenteditable="false" aria-hidden="true"></span>`;
}

// Add or remove `<span>` children so wrapper.childElementCount === count.
// O(delta), not O(count) — typing within a line is free once the count
// matches.
export function syncLineNumbersSpans(wrapper: HTMLElement, count: number): void {
    let current = wrapper.childElementCount;
    while (current < count) {
        wrapper.appendChild(wrapper.ownerDocument.createElement('span'));
        current++;
    }
    while (current > count) {
        wrapper.lastElementChild!.remove();
        current--;
    }
}

// Measure the actual visual top of every logical line using Range API, then
// set `top` on each span so line numbers align correctly in wrap mode (where
// a single logical line can span multiple visual rows).
//
// Measures every line before positioning any of them. Interleaving the two
// makes each measurement force a fresh layout, because the write before it
// invalidated the one it would otherwise have reused — and the layout it
// forces is of the whole document, not the block. On a 31 KB file of code
// blocks that was 45% of the time to open it.
//
// Must run after layout (call via requestAnimationFrame).
export function repositionLineNumberSpans(
    wrapper: HTMLElement,
    codeEl: HTMLElement,
): void {
    applyLineTops(wrapper, measureLineTops(wrapper, codeEl));
}

/** What one block's gutter needs, gathered without touching the DOM. */
interface ILineTops {
    tops: number[];
    /** For rows with no text to measure from; 0 when there are none. */
    lineHeight: number;
    spanCount: number;
}

function measureLineTops(
    wrapper: HTMLElement,
    codeEl: HTMLElement,
): ILineTops {
    const spans = Array.from(wrapper.children) as HTMLElement[];
    if (spans.length === 0)
        return { tops: [], lineHeight: 0, spanCount: 0 };

    const text = codeEl.textContent ?? '';

    // Global character offsets where each logical line begins.
    const lineStarts: number[] = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === LF)
            lineStarts.push(i + 1);
    }

    // Walk all text nodes once, positioning each span when we cross a line start.
    const walker = document.createTreeWalker(codeEl, NodeFilter.SHOW_TEXT);
    const range = document.createRange();

    let nodeStart = 0;
    let lineIdx = 0;
    const tops: number[] = [];
    let node = walker.nextNode() as Text | null;

    while (node !== null && lineIdx < lineStarts.length && lineIdx < spans.length) {
        const nodeLen = (node.textContent ?? '').length;
        const nodeEnd = nodeStart + nodeLen;

        // A line start may be INSIDE this node (< nodeEnd); if it equals nodeEnd
        // it belongs to the next node and will be picked up on the next iteration.
        while (lineIdx < lineStarts.length && lineIdx < spans.length && lineStarts[lineIdx] < nodeEnd) {
            const offsetInNode = lineStarts[lineIdx] - nodeStart;
            range.setStart(node, offsetInNode);
            range.collapse(true);
            tops.push(range.getBoundingClientRect().top);
            lineIdx++;
        }

        nodeStart = nodeEnd;
        node = walker.nextNode() as Text | null;
    }

    // Lines with no text node to measure from: the trailing empty line after a
    // final "\n", or the single line of a wholly empty code block. Read the
    // line height here, while nothing has been written yet.
    const lineHeight = tops.length < spans.length
        ? Number.parseFloat(getComputedStyle(wrapper).lineHeight) || 24
        : 0;

    return { tops, lineHeight, spanCount: spans.length };
}

function applyLineTops(wrapper: HTMLElement, measured: ILineTops): void {
    const { tops, lineHeight, spanCount } = measured;
    if (spanCount === 0)
        return;

    const spans = Array.from(wrapper.children) as HTMLElement[];

    // Origin = the measured top of the first logical line. A collapsed range's
    // rect top sits at the text/caret box (below the line-box leading), so
    // subtracting the wrapper top would offset every number down by that
    // constant leading. Anchoring to the first line cancels it and keeps line 1
    // flush with the gutter top, while preserving correct per-line deltas for
    // wrap mode.
    const baseTop = tops[0] ?? 0;
    for (let i = 0; i < tops.length && i < spans.length; i++)
        spans[i].style.top = `${tops[i] - baseTop}px`;

    // The unmeasured tail stacks one line-height below its predecessor; the
    // first line is always flush with the top.
    for (let i = tops.length; i < spans.length; i++) {
        const prevTop = i > 0 ? Number.parseFloat(spans[i - 1].style.top || '0') : 0;
        spans[i].style.top = i > 0 ? `${prevTop + lineHeight}px` : '0px';
    }
}

// Every code block owns a resize observer that repositions its gutter, and
// each repositioning forces a layout of the whole document to read the first
// rect. One per block is still one per block: opening a file of them cost
// 16.6 ms/KB at 220 blocks and 23.6 at 880, which is the shape of a quadratic.
//
// Batching them into one frame makes the whole set cost a single layout —
// every block is measured, and only then is any of them written to.
const pending = new Map<HTMLElement, HTMLElement>();
let frame: number | null = null;

export function scheduleLineNumberReposition(
    wrapper: HTMLElement,
    codeEl: HTMLElement,
): void {
    // Keyed by wrapper, so a block that resizes twice before the frame runs is
    // measured once, against whatever its code element holds by then.
    pending.set(wrapper, codeEl);
    if (frame !== null)
        return;

    frame = requestAnimationFrame(() => {
        frame = null;
        const batch = [...pending];
        pending.clear();

        const measured = batch.map(([w, c]) => measureLineTops(w, c));
        batch.forEach(([w], i) => applyLineTops(w, measured[i]!));
    });
}

// Drop anything queued for a wrapper that is going away, so a detached block
// cannot be measured on the next frame.
export function cancelLineNumberReposition(wrapper: HTMLElement): void {
    pending.delete(wrapper);
}
