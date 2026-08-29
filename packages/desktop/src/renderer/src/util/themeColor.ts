// Theme stylesheets, fetched one at a time.
//
// These used to be 63 `?inline` imports — every theme's CSS and every Prism
// CSS, ~260 KB of string literals, landing in the first-paint chunk so that one
// of them could be used. `import.meta.glob` keeps the same set of files but
// leaves each behind its own dynamic import, so a session downloads the theme
// it actually displays.

type CssLoader = () => Promise<string>

const themeCss = import.meta.glob('../assets/themes/*.theme.css', {
  query: '?inline',
  import: 'default'
}) as Record<string, CssLoader>

const prismCss = import.meta.glob('../assets/themes/prismjs/*.theme.css', {
  query: '?inline',
  import: 'default'
}) as Record<string, CssLoader>

/**
 * Themes whose syntax highlighting comes from a differently-named Prism theme.
 * Everything else pairs with the Prism file of the same name.
 */
const PRISM_ALIASES: Record<string, string> = {
  'material-dark': 'dark'
}

const load = async(loaders: Record<string, CssLoader>, path: string): Promise<string> => {
  const loader = loaders[path]
  if (!loader) {
    console.error(`[theme] no stylesheet for ${path}`)
    return ''
  }
  return loader()
}

/** True when `theme` has a stylesheet to load (i.e. is not the built-in light). */
export const hasThemeStylesheet = (theme: string): boolean =>
  `../assets/themes/${theme}.theme.css` in themeCss

/** The editor CSS for `theme`, followed by its Prism syntax-highlighting CSS. */
export const loadThemeCss = async(theme: string): Promise<string> => {
  const prismName = PRISM_ALIASES[theme] ?? theme
  const [editor, prism] = await Promise.all([
    load(themeCss, `../assets/themes/${theme}.theme.css`),
    load(prismCss, `../assets/themes/prismjs/${prismName}.theme.css`)
  ])
  return `${editor}\n${prism}`
}
