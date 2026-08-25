import type { Token } from 'marked';
import type { IFrontmatterToken, ILexOption, TLexedToken } from './types';
import { Marked } from 'marked';
import compatibleTaskList from './compatibleTaskList';
import footnoteExtension from './extensions/footnote';
import mathExtension from './extensions/math';
import fm from './frontMatter';
import { DEFAULT_OPTIONS } from './options';
import walkTokens from './walkTokens';

/**
 * The parts of a token this walk needs. Marked's `Token` is a discriminated
 * union that does not include list items or the muya front-matter token, and
 * every branch below only ever reads these four fields — so describe that
 * shape directly instead of casting between union members.
 */
interface IWalkableToken {
    type: string;
    tokens?: IWalkableToken[];
    items?: IWalkableToken[];
    header?: { tokens?: IWalkableToken[] }[];
    rows?: { tokens?: IWalkableToken[] }[][];
}

/**
 * Visit every token, including the ones nested in tables and lists.
 *
 * Mirrors the node coverage of `Marked.prototype.walkTokens` but drops its
 * return value. Marked accumulates one `values = values.concat(callback(...))`
 * per token, reallocating an ever-longer array for every node — quadratic in
 * document size, and by far the largest cost in parsing a large file (a 768 KB
 * document spent ~9.7 s there against ~65 ms in the lexer itself). Nothing in
 * muya reads the array it builds.
 *
 * No `childTokens` branch: that path only fires for extensions declaring
 * `childTokens`, and neither the math nor the footnote extension does.
 */
function walkAllTokens(
    tokens: IWalkableToken[],
    visit: (token: IWalkableToken) => void,
): void {
    for (const token of tokens) {
        visit(token);
        if (token.type === 'table') {
            for (const cell of token.header ?? []) {
                if (cell.tokens)
                    walkAllTokens(cell.tokens, visit);
            }
            for (const row of token.rows ?? []) {
                for (const cell of row) {
                    if (cell.tokens)
                        walkAllTokens(cell.tokens, visit);
                }
            }
        }
        else if (token.type === 'list') {
            if (token.items)
                walkAllTokens(token.items, visit);
        }
        else if (token.tokens) {
            walkAllTokens(token.tokens, visit);
        }
    }
}

export function lexBlock(
    src: string,
    options: ILexOption = DEFAULT_OPTIONS,
): TLexedToken[] {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    const { math, frontMatter, footnote } = options;
    let tokens: (Token | IFrontmatterToken)[] = [];

    // Use a per-call Marked instance so extensions don't bleed across calls.
    // marked.use() on the global singleton would make math / footnote sticky:
    // any consumer that once passed `math: true` would get math parsing forever.
    const m = new Marked();

    if (math) {
        m.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (footnote) {
        m.use(footnoteExtension());
    }

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            tokens.push(token);
            src = newSrc;
        }
    }

    // Pass `m.defaults` to the Lexer so the extensions registered via m.use()
    // are picked up; the no-arg constructor would fall back to global defaults.
    //
    // Appended one at a time rather than spread: the token count grows with the
    // document, and `push(...tokens)` passes each one as a separate argument,
    // so a large enough file overflowed the call stack and no document past a
    // few megabytes could be opened at all.
    for (const token of new m.Lexer(m.defaults).blockTokens(src))
        tokens.push(token);
    tokens = compatibleTaskList(tokens as Token[]);
    // The one place the two views of a token meet: `walkTokens` is written
    // against marked's `Token` union, the walker against the structural subset
    // it actually reads. Every `Token` satisfies `IWalkableToken`.
    const visitToken = walkTokens(options) as (token: IWalkableToken) => void;
    walkAllTokens(tokens, visitToken);

    // After walkTokens / compatibleTaskList run, marked's Heading/List/ListItem
    // tokens have been augmented with muya-specific fields (headingStyle,
    // marker, listType, listItemType, bulletMarkerOrDelimiter). The wider
    // TLexedToken union captures that runtime shape.
    return tokens as TLexedToken[];
}
