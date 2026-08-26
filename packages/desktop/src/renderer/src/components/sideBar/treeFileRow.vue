<template>
  <div
    class="file-row"
    :title="entry.pathname || entry.filename"
    :class="[
      { open: isOpen, active: isActive, unsaved: isOpen && entry.tab?.isSaved === false }
    ]"
    @click="activate"
  >
    <el-icon
      class="action-icon"
      :size="10"
      :title="isOpen ? t('menu.file.closeTab') : t('sideBar.tree.removeFromRecent')"
      @click.stop="dismiss"
    >
      <Close />
    </el-icon>
    <span class="name">{{ entry.filename }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { Close } from '@element-plus/icons-vue'
import { useEditorStore } from '@/store/editor'
import { useRecentFilesStore } from '@/store/recentFiles'
import type { FileEntry } from './types'

const props = defineProps<{
  entry: FileEntry
}>()

const { t } = useI18n()
const editorStore = useEditorStore()
const recentFilesStore = useRecentFilesStore()
const { currentFile } = storeToRefs(editorStore)

const isOpen = computed(() => props.entry.tab !== null)
const isActive = computed(() => {
  const { tab, pathname } = props.entry
  if (tab) return currentFile.value?.id === tab.id

  return !!pathname && currentFile.value?.pathname === pathname
})

/** Raise the tab if the file is open, otherwise open it. */
const activate = (): void => {
  const { tab, pathname } = props.entry
  if (tab) {
    if (tab.id !== currentFile.value?.id) editorStore.UPDATE_CURRENT_FILE(tab)
    return
  }
  if (pathname) window.electron.ipcRenderer.send('mt::open-file', pathname, {})
}

/**
 * The cross undoes whatever this row most recently became.
 *
 * An open file's salient state is that it is open, so the cross closes it —
 * which is what it did in the separate "opened files" section, and changing
 * that silently on merge would be worse than the inconsistency. The row itself
 * stays, now unmarked, because the file is still one you have worked with.
 * A file that is only in the list has nothing to close, so the cross takes it
 * off the list. The tooltip says which.
 */
const dismiss = (): void => {
  const { tab, pathname } = props.entry
  if (tab) {
    if (tab.isSaved) editorStore.FORCE_CLOSE_TAB(tab)
    else editorStore.CLOSE_UNSAVED_TAB(tab)
    return
  }
  recentFilesStore.REMOVE_RECENT_FILE(pathname)
}
</script>

<style scoped>
.file-row {
  display: flex;
  align-items: center;
  user-select: none;
  height: 28px;
  line-height: 28px;
  padding-left: 35px;
  position: relative;
  cursor: pointer;
  color: var(--sideBarColor);
  & > .action-icon {
    display: none;
    position: absolute;
    top: 9px;
    left: 10px;
    cursor: pointer;
  }
  &:hover > .action-icon {
    display: inline-flex;
  }
  &:hover {
    background: var(--sideBarItemHoverBgColor);
  }
  & > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.file-row.active {
  color: var(--highlightThemeColor);
}

/* The left gutter carries one mark at a time: a hollow ring for a file that is
   open, filled in when it also has unsaved changes. Hovering replaces either
   with the cross, which is the control for that spot. */
.file-row.open::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid var(--highlightThemeColor);
  box-sizing: border-box;
  position: absolute;
  top: 11px;
  left: 12px;
}
.file-row.open.unsaved::before {
  background: var(--highlightThemeColor);
}
.file-row.open:hover::before {
  content: none;
}
</style>
