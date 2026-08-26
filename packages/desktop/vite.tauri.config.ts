// Standalone Vite config that builds ONLY the renderer for the Tauri shell.
//
// electron-vite bundles main + preload + renderer together and targets the
// Electron runtime; Tauri needs just the renderer as a plain web app served
// from a static dir (or a dev server). This config mirrors the renderer half
// of electron.vite.config.ts (aliases, plugins, postcss) but emits to
// out-tauri/renderer with relative asset URLs so the tauri:// scheme resolves.

import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import svgLoader from 'vite-svg-loader'
import postcssPresetEnv from 'postcss-preset-env'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Fixed dev-server port so tauri.conf.json → build.devUrl can point at it.
const DEV_PORT = 5174

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  define: {
    global: 'globalThis'
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      common: resolve(__dirname, 'src/common'),
      '@shared': resolve(__dirname, 'src/shared'),
      path: 'pathe'
    },
    extensions: ['.mjs', '.ts', '.js', '.json', '.vue']
  },
  optimizeDeps: {
    include: ['pako', 'pathe'],
    esbuildOptions: {
      define: { global: 'globalThis' }
    }
  },
  assetsInclude: ['**/*.md'],
  plugins: [vue(), svgLoader()],
  css: {
    postcss: {
      plugins: [
        postcssPresetEnv({
          stage: 0,
          features: {
            'nesting-rules': true,
            // System WebViews (WebView2 / WKWebView / webkit2gtk) support CSS
            // logical properties natively — leave them intact so RTL mirrors.
            'logical-properties-and-values': false
          }
        })
      ]
    }
  },
  server: {
    port: DEV_PORT,
    strictPort: true
  },
  build: {
    outDir: resolve(__dirname, 'out-tauri/renderer'),
    emptyOutDir: true,
    target: 'esnext'
  }
})
