<template>
  <div
    class="recent-file"
    :title="file.pathname"
    :class="{ current: currentFile?.pathname === file.pathname }"
    @click="openFile"
  >
    <el-icon
      class="remove-icon"
      :size="10"
      :title="t('sideBar.tree.removeFromRecent')"
      @click.stop="removeFile"
    >
      <Close />
    </el-icon>
    <span class="name">{{ file.filename }}</span>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { Close } from '@element-plus/icons-vue'
import { useEditorStore } from '@/store/editor'
import { useRecentFilesStore, type RecentFile } from '@/store/recentFiles'

const props = defineProps<{
  file: RecentFile
}>()

const { t } = useI18n()
const editorStore = useEditorStore()
const recentFilesStore = useRecentFilesStore()

const { currentFile, tabs } = storeToRefs(editorStore)

const openFile = (): void => {
  const { pathname } = props.file
  const openedTab = tabs.value.find((tab) => window.fileUtils.isSamePathSync(tab.pathname, pathname))
  if (openedTab) {
    if (currentFile.value?.pathname !== openedTab.pathname) {
      editorStore.UPDATE_CURRENT_FILE(openedTab)
    }
    return
  }
  window.electron.ipcRenderer.send('mt::open-file', pathname, {})
}

const removeFile = (): void => {
  recentFilesStore.REMOVE_RECENT_FILE(props.file.pathname)
}
</script>

<style scoped>
.recent-file {
  display: flex;
  user-select: none;
  height: 28px;
  line-height: 28px;
  padding-left: 35px;
  position: relative;
  cursor: pointer;
  color: var(--sideBarColor);
  & > .remove-icon {
    display: none;
    position: absolute;
    top: 9px;
    left: 10px;
    cursor: pointer;
  }
  &:hover > .remove-icon {
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
.recent-file.current {
  color: var(--highlightThemeColor);
}
</style>
