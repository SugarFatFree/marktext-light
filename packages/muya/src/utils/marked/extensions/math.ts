import katex from 'katex';
import 'katex/dist/contrib/mhchem.mjs';

export interface IMathToken {
    type: 'inlineMath' | 'multiplemath';
    raw: string;
    text: string;
    displayMode: boolean;
    mathStyle?: '' | 'gitlab';
}

interface IOptions {
    throwOnError?: boolean;
    useKatexRender?: boolean;
    /**
     * Register the inline `$…$` rule. Default true.
     *
     * Registering a rule is not free: marked consults every extension's
     * `start()` on the whole remaining source at each token boundary, so a rule
     * that cannot possibly match still costs a scan per boundary. Callers that
     * can prove a rule is impossible for a given document should switch it off
     * — see `lexBlock`.
     */
    inline?: boolean;
    /** Register the block `$$\n…\n$$` rule. Default true. */
    block?: boolean;
}

const inlineStartRule = /(\s|^)\${1,2}(?!\$)/;
const inlineRule
    = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1(?=[\s?!.,:]|$)/;
const blockRule = /^(\${1,2})\n((?:\\[\s\S]|[^\\])+?)\n\1[ \t]*(?:\n|$)/;

const DEFAULT_OPTIONS = {
    throwOnError: false,
    useKatexRender: false,
    inline: true,
    block: true,
};

export default function (options: IOptions = {}) {
    const opts = Object.assign({}, DEFAULT_OPTIONS, options);
    const extensions = [];

    if (opts.inline)
        extensions.push(inlineKatex(createRenderer(opts, false)));
    if (opts.block)
        extensions.push(blockKatex(createRenderer(opts, true)));

    return { extensions };
}

function createRenderer(options: IOptions, newlineAfter: boolean) {
    return (token: IMathToken) => {
        const { useKatexRender, ...otherOpts } = options;
        const { type, text, displayMode, mathStyle } = token;
        if (useKatexRender) {
            return (
                katex.renderToString(text, {
                    ...otherOpts,
                    displayMode,
                }) + (newlineAfter ? '\n' : '')
            );
        }
        else {
            return type === 'inlineMath'
                ? `$${text}$`
                : `<pre class="multiple-math" data-math-style="${mathStyle}">${text}</pre>\n`;
        }
    };
}

function inlineKatex(renderer: (token: IMathToken) => string) {
    return {
        name: 'inlineMath',
        level: 'inline' as const,
        start(src: string) {
            const match = src.match(inlineStartRule);
            if (!match)
                return;

            const index = (match.index || 0) + match[1].length;
            const possibleKatex = src.substring(index);

            if (inlineRule.test(possibleKatex))
                return index;
        },
        tokenizer(src: string) {
            const match = src.match(inlineRule);
            if (match) {
                return {
                    type: 'inlineMath',
                    raw: match[0],
                    text: match[2].trim(),
                    displayMode: match[1].length === 2,
                };
            }
        },
        renderer,
    };
}

function blockKatex(renderer: (token: IMathToken) => string) {
    return {
        name: 'multiplemath',
        level: 'block' as const,
        start(src: string) {
            return src.indexOf('\n$');
        },
        tokenizer(src: string) {
            const match = src.match(blockRule);
            if (match) {
                return {
                    type: 'multiplemath',
                    raw: match[0],
                    text: match[2].trim(),
                    displayMode: match[1].length === 2,
                    mathStyle: '',
                };
            }
        },
        renderer,
    };
}
