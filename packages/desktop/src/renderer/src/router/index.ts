import type { RouteRecordRaw } from 'vue-router'

// Every route is an async import. A window only ever visits one of these two
// trees — the editor never opens a settings panel and vice versa — so a static
// import would put the whole settings UI in the editor window's entry chunk and
// delay first paint for code it will never run.
//
// .vue extensions are explicit so TS resolves them through the *.vue module
// shim in src/types/renderer.d.ts. Vite handles extension-less imports at
// runtime, but vue-tsc needs the suffix.
const App = () => import('@/pages/app.vue')
const Preference = () => import('@/pages/preference.vue')
const General = () => import('@/prefComponents/general/index.vue')
const Editor = () => import('@/prefComponents/editor/index.vue')
const Markdown = () => import('@/prefComponents/markdown/index.vue')
const SpellChecker = () => import('@/prefComponents/spellchecker/index.vue')
const Theme = () => import('@/prefComponents/theme/index.vue')
const Image = () => import('@/prefComponents/image/index.vue')
const Keybindings = () => import('@/prefComponents/keybindings/index.vue')

const parseSettingsPage = (type: string | null | undefined): string => {
  let pageUrl = '/preference'
  if (type && /\/spelling$/.test(type)) {
    pageUrl += '/spelling'
  }
  return pageUrl
}

const routes = (type: string | null | undefined): RouteRecordRaw[] => [
  {
    path: '/',
    redirect: type === 'editor' ? '/editor' : parseSettingsPage(type)
  },
  {
    path: '/editor',
    component: App
  },
  {
    path: '/preference',
    component: Preference,
    children: [
      {
        path: '',
        component: General
      },
      {
        path: 'general',
        component: General,
        name: 'general'
      },
      {
        path: 'editor',
        component: Editor,
        name: 'editor'
      },
      {
        path: 'markdown',
        component: Markdown,
        name: 'markdown'
      },
      {
        path: 'spelling',
        component: SpellChecker,
        name: 'spelling'
      },
      {
        path: 'theme',
        component: Theme,
        name: 'theme'
      },
      {
        path: 'image',
        component: Image,
        name: 'image'
      },
      {
        path: 'keybindings',
        component: Keybindings,
        name: 'keybindings'
      }
    ]
  }
]

export default routes
