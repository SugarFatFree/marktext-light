<template>
  <div
    v-if="isTauriEnv"
    class="tauri-menu-bar"
  >
    <div class="menu-bar-items title-no-drag">
      <el-dropdown
        v-for="section in sections"
        :key="section.titleKey"
        trigger="click"
        placement="bottom-start"
        popper-class="tauri-menu-dropdown"
        @command="dispatchMenu"
      >
        <span class="menu-bar-title">{{ label(section.titleKey) }}</span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item
              v-for="item in section.items"
              :key="item.id"
              :command="item.id"
              :divided="item.divided"
            >
              <span class="mb-label">{{ label(item.labelKey) }}</span>
              <span
                v-if="item.accel"
                class="mb-accel"
              >{{ item.accel }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <!-- Draggable filler between the menu and the window controls. -->
    <div
      class="menu-bar-drag"
      data-tauri-drag-region
    />

    <div class="menu-bar-window-controls title-no-drag">
      <button
        class="win-ctl"
        type="button"
        @click="minimize"
      >
        <svg
          width="10"
          height="10"
        ><path :d="minimizePath" /></svg>
      </button>
      <button
        class="win-ctl"
        type="button"
        @click="toggleMaximize"
      >
        <svg
          width="10"
          height="10"
        ><path :d="isMaximized ? restorePath : maximizePath" /></svg>
      </button>
      <button
        class="win-ctl win-ctl-close"
        type="button"
        @click="close"
      >
        <svg
          width="10"
          height="10"
        ><path :d="closePath" /></svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { t } from '@/i18n'
import { isTauri } from '@/tauri-bridge'
import { closePath, restorePath, maximizePath, minimizePath } from '@/assets/window-controls'
import { MENU_STRUCTURE } from './structure'

const isTauriEnv = isTauri()
const sections = MENU_STRUCTURE
const isMaximized = ref(false)

// Locale strings carry a Windows access-key mnemonic — '&Theme' (Latin) or
// '主题(&T)' (CJK). Native menus consume it; strip it for the HTML menu bar.
const label = (key: string): string =>
  t(key)
    .replace(/\(&[^)]*\)/g, '')
    .replace(/&/g, '')

const dispatchMenu = (id: string): void => {
  invoke('dispatch_menu', { id }).catch((err) => console.error('[menu-bar]', err))
}

const refreshMaximized = async (): Promise<void> => {
  try {
    isMaximized.value = await window.electron.windowControl.isMaximized()
  } catch {
    /* ignore */
  }
}

const minimize = (): void => window.electron.windowControl.minimize()
const close = (): void => window.electron.windowControl.close()
const toggleMaximize = (): void => {
  window.electron.windowControl.toggleMaximize()
  // The native state settles a frame later; re-query to update the icon.
  setTimeout(refreshMaximized, 80)
}

onMounted(() => {
  if (isTauriEnv) void refreshMaximized()
})
</script>

<style scoped>
.tauri-menu-bar {
  display: flex;
  align-items: stretch;
  height: 30px;
  width: 100%;
  box-sizing: border-box;
  background: var(--editorBgColor);
  border-bottom: 1px solid var(--floatBorderColor);
  user-select: none;
}

.menu-bar-items {
  display: flex;
  align-items: center;
  padding-left: 6px;
}

.menu-bar-drag {
  flex: 1;
  align-self: stretch;
}

.menu-bar-title {
  padding: 3px 9px;
  font-size: 13px;
  border-radius: 4px;
  cursor: default;
  color: var(--editorColor);
  outline: none;
  white-space: nowrap;
}

.menu-bar-title:hover {
  background: var(--floatHoverColor);
}

.menu-bar-window-controls {
  display: flex;
  align-items: stretch;
}

.win-ctl {
  width: 40px;
  border: none;
  background: transparent;
  color: var(--editorColor);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.win-ctl svg path {
  fill: currentColor;
}

.win-ctl:hover {
  background: var(--floatHoverColor);
}

.win-ctl-close:hover {
  background: #e81123;
  color: #fff;
}
</style>

<!-- Dropdown menus teleport to <body>; their styles must be global and pull
     from the MarkText theme variables (defined on :root) so they follow the
     active theme instead of Element Plus's default white. -->
<style>
.tauri-menu-dropdown.el-popper,
.tauri-menu-dropdown .el-dropdown-menu {
  background-color: var(--floatBgColor, #fff) !important;
  border-color: var(--floatBorderColor, #e0e0e0) !important;
}

.tauri-menu-dropdown .el-popper__arrow::before {
  background: var(--floatBgColor, #fff) !important;
  border-color: var(--floatBorderColor, #e0e0e0) !important;
}

.tauri-menu-dropdown .el-dropdown-menu__item {
  display: flex;
  align-items: center;
  min-width: 190px;
  color: var(--editorColor, #303133);
}

.tauri-menu-dropdown .el-dropdown-menu__item.el-dropdown-menu__item--divided {
  border-top-color: var(--floatBorderColor, #e0e0e0);
}

.tauri-menu-dropdown .el-dropdown-menu__item:not(.is-disabled):hover,
.tauri-menu-dropdown .el-dropdown-menu__item:not(.is-disabled):focus {
  background-color: var(--floatHoverColor, #f2f6fc) !important;
  color: var(--themeColor, #409eff) !important;
}

.tauri-menu-dropdown .mb-accel {
  margin-left: auto;
  padding-left: 32px;
  opacity: 0.55;
  font-size: 12px;
}
</style>
