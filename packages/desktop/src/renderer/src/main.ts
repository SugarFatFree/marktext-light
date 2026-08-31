// MUST be first: synchronously installs the Tauri window.* globals (window.path,
// window.electron, …) before any other module reads them at import time. No-op
// under Electron. See tauri-bridge/preload-sync.
import './tauri-bridge/preload-sync'

import { createApp, type App } from 'vue'
import { createRouter, createWebHashHistory } from 'vue-router'
import bootstrapRenderer from './bootstrap'
import pinia from './store'
import './assets/symbolIcon'

// Element Plus, registered component by component rather than as the whole
// library: `app.use(ElementPlus)` pins every one of its ~80 components into the
// entry chunk, and this app uses 25. Adding an `<el-…>` tag to a template means
// adding it to this list.
//
// No locale is passed — Element Plus already defaults to English, which is what
// the plugin form was configured with. The app's own strings go through i18n.
import type { Plugin } from 'vue'
import {
  ElButton,
  ElCol,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInputNumber,
  ElRow,
  ElTabPane,
  ElTabs,
  ElTooltip,
  ElTree
} from 'element-plus'
// Styles for exactly the components above. The full stylesheet is 349 KB of
// the 508 KB the entry linked, for fifteen of the library's hundred-odd
// components — and a stylesheet is worse than a chunk of script: the browser
// paints nothing until it has the whole thing.
//
// Each of these entrypoints pulls in its own dependencies' styles (dialog
// brings overlay, tree brings checkbox and text), so the chain is Element
// Plus's own declaration rather than a list of internals guessed at here. The
// component list above is what has to stay in sync, and
// `element-plus-registration.spec.ts` already holds it against the `<el-…>`
// tags both windows actually render.
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/col/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/dropdown/style/css'
import 'element-plus/es/components/dropdown-item/style/css'
import 'element-plus/es/components/dropdown-menu/style/css'
import 'element-plus/es/components/form/style/css'
import 'element-plus/es/components/form-item/style/css'
import 'element-plus/es/components/icon/style/css'
import 'element-plus/es/components/input-number/style/css'
import 'element-plus/es/components/row/style/css'
import 'element-plus/es/components/tab-pane/style/css'
import 'element-plus/es/components/tabs/style/css'
import 'element-plus/es/components/tooltip/style/css'
import 'element-plus/es/components/tree/style/css'

// The editor window's set. The settings window registers its own extras when
// that tree loads — see prefComponents/settingsComponents.ts — because the
// table and the select alone cost 141 KB of first paint here for markup this
// window never renders.
const ELEMENT_PLUS_COMPONENTS = [
  ElButton,
  ElCol,
  ElDialog,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInputNumber,
  ElRow,
  ElTabPane,
  ElTabs,
  ElTooltip,
  ElTree
] as unknown as Plugin[]

// I18n translation system
import i18nPlugin from './i18n'

// something is wrong here! \/
import services from './services/index'
import routes from './router'
import Main from './Main.vue'

import { installTauriBridge, isTauri } from './tauri-bridge'
import { markStartup, markNetworkTimings } from './util/startupTrace'
import { armSplashSafetyNet } from './util/splash'
import { usePreferencesStore } from './store/preferences'

import './assets/styles/index.css'
import './assets/styles/printService.css'

// -----------------------------------------------

// Under the Tauri shell there is no Electron preload injecting `window.electron`
// & friends, so install the invoke-backed bridge and complete the boot-info
// handshake before anything reads those globals. A no-op under Electron.
// At module scope on purpose: by the time this line runs, every static import
// above has been fetched, parsed and evaluated. It is the first moment the
// renderer can speak for itself, and the gap between navigation and here is the
// cost of the bundle rather than of anything the app does.
markNetworkTimings()
markStartup('script start')

// Armed here rather than after mount, so that a failure anywhere in `start()`
// below — a bridge handshake that never resolves, a throw in bootstrap — still
// ends with the window showing something other than the loading screen.
armSplashSafetyNet()

async function start(): Promise<void> {
  if (isTauri()) {
    await installTauriBridge()
  }
  markStartup('shell bridge')

  window.marktext = {}
  bootstrapRenderer()

  // -----------------------------------------------
  // Be careful when changing code before this line!

  // Create Vue app
  const app: App<Element> = createApp(Main)

  for (const component of ELEMENT_PLUS_COMPONENTS) {
    app.use(component)
  }

  const envType = window.marktext?.env?.type as string | undefined

  const router = createRouter({
    history: createWebHashHistory(),
    // it seems like something might have changed in vue-router? it uses the full "file path" instead of
    // links like /editor if we use the old createWebHistory()
    routes: routes(envType)
  })

  app.use(router)
  app.use(pinia)
  app.use(i18nPlugin)

  // Register services globally
  ;(services as unknown as Array<Record<string, unknown> & { name: string }>).forEach((s) => {
    app.config.globalProperties['$' + s.name] = s[s.name]
  })

  // Before the first render, not after it.
  //
  // These five come from the URL the window was opened with, so they are known
  // here. Applying them from `app.vue`'s `onMounted` meant rendering the shell
  // once with the defaults, then changing them, then rendering it again — and
  // that second pass was measured at 207 ms of a 2.2 s startup, the largest
  // thing left that the app controls. Setting them first means there is nothing
  // to re-render.
  if (window.marktext?.initialState) {
    usePreferencesStore(pinia).SET_USER_PREFERENCE(window.marktext.initialState)
  }

  // Mount the app
  app.mount('#app')
  markStartup('mounted')
}

start().catch((err) => console.error('[marktext] renderer init failed', err))
