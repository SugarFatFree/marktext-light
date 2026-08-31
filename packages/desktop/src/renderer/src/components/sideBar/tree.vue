<template>
  <div class="tree-view">
    <div class="title">
      <!-- Placeholder -->
    </div>

    <!-- Everything you have opened recently; the ones still open are marked.
         Two sections used to split these, which meant a file you had open was
         listed twice and the same click did different things depending on which
         copy you hit. -->
    <div class="file-list">
      <div class="title">
        <el-icon
          class="icon-arrow"
          :class="{ fold: !showFileList }"
          :size="12"
          @click.stop="toggleFileList()"
        >
          <ArrowRight />
        </el-icon>
        <span
          class="default-cursor text-overflow"
          @click.stop="toggleFileList()"
        >{{
          t('sideBar.tree.files')
        }}</span>
        <!-- Always visible, unlike its neighbours: with the standing button
             gone this is the drawer's only way in, and an empty drawer is
             exactly when nothing is there to hint that hovering reveals it.
             The choice happens before the dialog rather than inside it —
             Windows and GTK pickers choose files or directories, not either. -->
        <el-dropdown
          class="open-entry"
          trigger="click"
          @command="openTarget"
        >
          <a
            href="javascript:;"
            :title="t('sideBar.tree.open')"
          >
            <el-icon :size="14">
              <FolderOpened />
            </el-icon>
          </a>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="file">
                {{ t('menu.file.openFile') }}
              </el-dropdown-item>
              <el-dropdown-item command="folder">
                {{ t('menu.file.openFolder') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <a
          v-if="hasOpenTabs"
          href="javascript:;"
          :title="t('sideBar.tree.saveAll')"
          @click.stop="saveAll(false)"
        >
          <svg
            class="icon"
            aria-hidden="true"
          >
            <use xlink:href="#icon-save-all" />
          </svg>
        </a>
        <a
          href="javascript:;"
          :title="t('sideBar.tree.clearRecent')"
          @click.stop="clearRecentFiles"
        >
          <svg
            class="icon"
            aria-hidden="true"
          >
            <use xlink:href="#icon-close-all" />
          </svg>
        </a>
      </div>
      <div
        v-show="showFileList"
        class="file-list-items"
      >
        <transition-group name="list">
          <file-row
            v-for="entry of fileEntries"
            :key="entry.key"
            :entry="entry"
          />
        </transition-group>
      </div>
    </div>

    <!-- Project tree view -->
    <div
      v-if="projectTree"
      class="project-tree"
    >
      <div
        class="title"
        @contextmenu.prevent="handleRootContextMenu"
      >
        <el-icon
          class="icon-arrow"
          :class="{ fold: !showDirectories }"
          :size="12"
          @click.stop="toggleDirectories()"
        >
          <ArrowRight />
        </el-icon>
        <span
          class="default-cursor text-overflow"
          @click.stop="toggleDirectories()"
        >{{
          projectTree.name
        }}</span>
      </div>
      <div
        v-show="showDirectories"
        class="tree-wrapper"
      >
        <folder
          v-for="folder of projectTree.folders"
          :key="folder.id"
          :folder="folder"
          :depth="depth"
        />
        <input
          v-show="createCacheDirname === projectTree.pathname"
          ref="input"
          v-model="createName"
          :placeholder="t('sideBar.tree.newFilePlaceholder')"
          type="text"
          class="new-input"
          :style="{ 'margin-left': `${depth * 5 + 15}px` }"
          @keypress.enter="handleInputEnter"
        >
        <file
          v-for="file of projectTree.files"
          :key="file.id"
          :file="file"
          :depth="depth"
        />
        <div
          v-if="
            projectTree.files.length === 0 &&
              projectTree.folders.length === 0 &&
              createCacheDirname !== projectTree.pathname
          "
          class="empty-project"
        >
          <span>{{ t('sideBar.tree.emptyProject') }}</span>
          <div class="centered-group">
            <button
              class="button-primary"
              @click.stop="createFile"
            >
              {{ t('sideBar.tree.createFile') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { useRecentFilesStore } from '@/store/recentFiles'
import Folder from './treeFolder.vue'
import File from './treeFile.vue'
import FileRow from './treeFileRow.vue'
import { mergeFileEntries } from './mergeFileEntries'
import bus from '../../bus'
import { showContextMenu } from '../../contextMenu/sideBar'
import { useI18n } from 'vue-i18n'
import { ArrowRight, FolderOpened } from '@element-plus/icons-vue'
import type { FileEntry, TreeNode, TabDescriptor } from './types'

const { t } = useI18n()

const props = defineProps<{
  // The project store seeds `projectTree` as `null` until a folder is opened,
  // and the whole tree section hides behind `v-if="projectTree"` until then.
  // Type the prop nullable to match runtime + the template guard.
  projectTree: TreeNode | null
  tabs?: TabDescriptor[]
}>()

const depth = 0
// Persist the section collapse state (#2421). The tree is rendered under a
// v-if and is destroyed when the sidebar collapses to its icon strip, so local
// refs reset to expanded on re-open. Back them with localStorage (like the
// sidebar width) so the state survives a re-mount and app restart.
const SHOW_DIRECTORIES_KEY = 'side-bar-show-directories'
// One key for the merged list. The two old ones are left behind rather than
// migrated: the worst a stale entry does is collapse a section once.
const SHOW_FILE_LIST_KEY = 'side-bar-show-files'
const readSectionExpanded = (key: string): boolean => localStorage.getItem(key) !== 'false'
const showDirectories = ref(readSectionExpanded(SHOW_DIRECTORIES_KEY))
const showFileList = ref(readSectionExpanded(SHOW_FILE_LIST_KEY))
const createName = ref('')
const input = ref<HTMLInputElement | null>(null)

const projectStore = useProjectStore()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const recentFilesStore = useRecentFilesStore()

// Computed properties
const { createCache } = storeToRefs(projectStore)
const { clipboard } = storeToRefs(projectStore)
const { openedFilesInSidebar } = storeToRefs(preferencesStore)
const { recentFiles } = storeToRefs(recentFilesStore)

/**
 * The merged list: everything opened recently, with the ones still open marked.
 *
 * Recency order comes from the recent-files store, and every saved file that
 * gets opened is recorded there, so open files sit near the top by themselves —
 * no need to group them and reintroduce the split this replaces.
 *
 * Untitled documents are the exception: they have a tab but no path, so the
 * store never sees them. They go first, since they exist only in this session
 * and nothing else in the drawer would show them.
 *
 * `openedFilesInSidebar` still means what its label says. Turned off, the list
 * is the recent files alone: no marks, and no untitled rows.
 */
/** Whether "save all" has anything to act on. */
const hasOpenTabs = computed(() => (props.tabs ?? []).length > 0)

const fileEntries = computed<FileEntry[]>(() =>
  mergeFileEntries(props.tabs ?? [], recentFiles.value, openedFilesInSidebar.value)
)

// The createCache state is `{ dirname, type }` while an input is shown, and
// `{}` otherwise. Expose a typed accessor for the template so we don't have
// to thread `as any` through every comparison.
const createCacheDirname = computed<string | undefined>(() => {
  const cache = createCache.value as { dirname?: string }
  return cache.dirname
})

// Methods
const openTarget = (command: string): void => {
  if (command === 'folder') {
    projectStore.ASK_FOR_OPEN_PROJECT()
    return
  }
  window.electron.ipcRenderer.send('mt::cmd-open-file')
}

const saveAll = (isClose: boolean): void => {
  editorStore.ASK_FOR_SAVE_ALL(isClose)
}

const createFile = (): void => {
  projectStore.CHANGE_ACTIVE_ITEM(props.projectTree)
  bus.emit('SIDEBAR::new', 'file')
}

const handleRootContextMenu = (event: MouseEvent): void => {
  projectStore.CHANGE_ACTIVE_ITEM(props.projectTree)
  showContextMenu(event, !!clipboard.value)
}

const toggleFileList = (): void => {
  showFileList.value = !showFileList.value
  localStorage.setItem(SHOW_FILE_LIST_KEY, String(showFileList.value))
}

const clearRecentFiles = (): void => {
  recentFilesStore.CLEAR_RECENT_FILES()
}

const toggleDirectories = (): void => {
  showDirectories.value = !showDirectories.value
  localStorage.setItem(SHOW_DIRECTORIES_KEY, String(showDirectories.value))
}

// From createFileOrDirectoryMixins
const handleInputFocus = (): void => {
  nextTick(() => {
    if (input.value) {
      input.value.focus()
      createName.value = ''
    }
  })
}

const handleInputEnter = (): void => {
  projectStore.CREATE_FILE_DIRECTORY(createName.value)
}

/**
 * Abandon a half-typed rename or create.
 *
 * On `document`, not on the tree, because the click that means "never mind" is
 * usually outside it. Buttons that open these inputs use `@click.stop` so their
 * own click never reaches here.
 */
const dismissInputs = (event: Event): void => {
  const target = event.target as HTMLElement | null
  if (target && target.tagName === 'INPUT') return
  projectStore.CHANGE_ACTIVE_ITEM({})
  projectStore.createCache = {}
  projectStore.renameCache = null
}

const dismissInputsOnContextMenu = (event: Event): void => {
  const target = event.target as HTMLElement | null
  if (target && target.tagName === 'INPUT') return
  projectStore.createCache = {}
  projectStore.renameCache = null
}

const dismissInputsOnEscape = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return
  projectStore.createCache = {}
  projectStore.renameCache = null
}

onMounted(() => {
  bus.on('SIDEBAR::show-new-input', handleInputFocus)
  document.addEventListener('click', dismissInputs)
  document.addEventListener('contextmenu', dismissInputsOnContextMenu)
  document.addEventListener('keydown', dismissInputsOnEscape)
})

// All four were registered and never removed. The bus handler leaked once per
// time the sidebar was shown; the three document listeners are worse, because
// they outlive the component that wanted them and go on running on every click
// and keystroke in the app, each holding the store through its closure.
//
// They were anonymous, which is why they could not be removed — naming them is
// most of the fix.
onBeforeUnmount(() => {
  bus.off('SIDEBAR::show-new-input', handleInputFocus)
  document.removeEventListener('click', dismissInputs)
  document.removeEventListener('contextmenu', dismissInputsOnContextMenu)
  document.removeEventListener('keydown', dismissInputsOnEscape)
})

</script>

<style scoped>
.list-item {
  display: inline-block;
  margin-right: 10px;
}

.list-enter-active,
.list-leave-active {
  transition: all 0.2s;
}
.list-enter, .list-leave-to
  /* .list-leave-active for below version 2.1.8 */ {
  opacity: 0;
  transform: translateX(-50px);
}
.tree-view {
  font-size: 14px;
  color: var(--sideBarColor);
  display: flex;
  flex-direction: column;
  height: 100%;
}
.tree-view > .title {
  height: 35px;
  line-height: 35px;
  padding: 0 15px;
  display: flex;
  flex-shrink: 0;
  flex-direction: row-reverse;
}

.icon-arrow {
  margin-right: 5px;
  transition: transform 0.25s ease-out;
  transform: rotate(90deg);
  color: var(--sideBarTextColor);
  cursor: pointer;
}

.icon-arrow.fold {
  transform: rotate(0);
}

.file-list > .title,
.project-tree > .title {
  height: 30px;
  line-height: 30px;
  font-size: 14px;
}

.file-list .title {
  padding-right: 15px;
  display: flex;
  align-items: center;
}

.file-list .title > span {
  flex: 1;
}

.file-list .title > a {
  display: none;
  text-decoration: none;
  color: var(--sideBarColor);
  margin-left: 8px;
}
.file-list div.title:hover > a,
.file-list div.title > a:hover {
  display: block;
}

.file-list div.title:hover > a:hover,
.file-list div.title > a:hover:hover {
  color: var(--highlightThemeColor);
}

.file-list .title > .open-entry {
  display: flex;
  align-items: center;
  margin-left: 8px;
  outline: none;
}

.file-list .title > .open-entry > a {
  display: flex;
  text-decoration: none;
  color: var(--sideBarColor);
}

.file-list .title > .open-entry > a:hover {
  color: var(--highlightThemeColor);
}
.file-list {
  display: flex;
  flex-direction: column;
}
.default-cursor {
  cursor: pointer;
}
.file-list .file-list-items {
  max-height: 112px;
  overflow: auto;
  flex: 1;
}

.file-list .file-list-items::-webkit-scrollbar:vertical {
  width: 8px;
}

.file-list {
  display: flex;
  flex-direction: column;
}

.file-list .title {
  padding-right: 15px;
  display: flex;
  align-items: center;
}

.file-list .title > span {
  flex: 1;
}

.file-list .title > a {
  display: none;
  text-decoration: none;
  color: var(--sideBarColor);
  margin-left: 8px;
}

.file-list div.title:hover > a,
.file-list div.title > a:hover {
  display: block;
}

.file-list div.title:hover > a:hover {
  color: var(--highlightThemeColor);
}

.file-list .file-list-items {
  max-height: 168px;
  overflow: auto;
  flex: 1;
}

.file-list .file-list-items::-webkit-scrollbar:vertical {
  width: 8px;
}

.project-tree {
  display: flex;
  flex-direction: column;
  overflow: auto;
  flex: 1;
}

.project-tree > .title {
  padding-right: 15px;
  display: flex;
  align-items: center;
}

.project-tree > .title > span {
  flex: 1;
  user-select: none;
}

.project-tree > .title > a {
  pointer-events: auto;
  cursor: pointer;
  margin-left: 8px;
  color: var(--sideBarIconColor);
  opacity: 0;
}

.project-tree > .title > a:hover {
  color: var(--highlightThemeColor);
}

.project-tree > .title > a.active {
  color: var(--highlightThemeColor);
}

.project-tree > .tree-wrapper {
  overflow: auto;
  flex: 1;
}

.project-tree > .tree-wrapper::-webkit-scrollbar:vertical {
  width: 8px;
}
.project-tree div.title:hover > a {
  opacity: 1;
}
.empty-project .el-button.is-text.is-has-bg {
  background-color: var(--buttonPrimaryBgColor);
  color: var(--buttonPrimaryFontColor);
  border-color: transparent;
}
.empty-project .el-button.is-text.is-has-bg:hover,
.empty-project .el-button.is-text.is-has-bg:focus {
  background-color: var(--buttonPrimaryBgColorHover);
  color: var(--buttonPrimaryFontColorHover);
}
.new-input {
  outline: none;
  height: 22px;
  margin: 5px 0;
  padding: 0 6px;
  color: var(--sideBarColor);
  border: 1px solid var(--floatBorderColor);
  background: var(--inputBgColor);
  width: calc(100% - 45px);
  border-radius: 3px;
}
.tree-wrapper {
  position: relative;
}
.empty-project {
  font-size: 14px;
  display: flex;
  flex-direction: column;
  padding-top: 40px;
  align-items: center;
  color: var(--sideBarTextColor);
  & button {
    margin-top: 10px;
  }
}

.empty-project > a {
  color: var(--highlightThemeColor);
  text-align: center;
  margin-top: 15px;
  text-decoration: none;
}
.bold {
  font-weight: 600;
}
</style>
