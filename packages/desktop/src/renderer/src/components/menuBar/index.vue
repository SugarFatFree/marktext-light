<template>
  <div
    v-if="isTauriEnv"
    class="tauri-menu-bar title-no-drag"
  >
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
</template>

<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import { t } from '@/i18n'
import { isTauri } from '@/tauri-bridge'
import { MENU_STRUCTURE } from './structure'

const isTauriEnv = isTauri()
const sections = MENU_STRUCTURE

// Locale strings carry a Windows mnemonic '&' (e.g. '&Theme'); strip it for the
// HTML menu bar (native menus consume it, the DOM shows it literally).
const label = (key: string): string => t(key).replace(/&/g, '')

const dispatchMenu = (id: string): void => {
  invoke('dispatch_menu', { id }).catch((err) => console.error('[menu-bar]', err))
}
</script>

<style scoped>
.tauri-menu-bar {
  display: flex;
  align-items: center;
  height: 100%;
  -webkit-app-region: no-drag;
}

.menu-bar-title {
  padding: 2px 8px;
  font-size: 13px;
  border-radius: 3px;
  cursor: default;
  color: var(--sideBarTitleColor);
  outline: none;
  white-space: nowrap;
}

.menu-bar-title:hover {
  background: var(--floatHoverColor);
}
</style>

<!-- Dropdown menus teleport to <body>, so their styles must be global. -->
<style>
.tauri-menu-dropdown .el-dropdown-menu__item {
  display: flex;
  align-items: center;
  min-width: 180px;
}

.tauri-menu-dropdown .mb-accel {
  margin-left: auto;
  padding-left: 32px;
  opacity: 0.55;
  font-size: 12px;
}
</style>
