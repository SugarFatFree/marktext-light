<template>
  <div class="unsaved-files">
    <el-dialog
      v-model="show"
      :title="t('dialog.saveChanges')"
      :close-on-click-modal="false"
      width="420px"
      @close="respondWith('cancel')"
    >
      <ul class="file-list">
        <li
          v-for="file of files"
          :key="file.id"
          :title="file.pathname"
        >
          {{ file.filename }}
        </li>
      </ul>
      <p class="detail">
        {{ t('dialog.changesWillBeLost') }}
      </p>
      <template #footer>
        <el-button @click="respondWith('cancel')">
          {{ t('dialog.cancel') }}
        </el-button>
        <el-button @click="respondWith('dontSave')">
          {{ t('dialog.dontSave') }}
        </el-button>
        <el-button
          type="primary"
          @click="respondWith('save')"
        >
          {{ t('dialog.save') }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import bus from '../../bus'
import {
  UNSAVED_FILES_ASK_EVENT,
  type UnsavedFilesRequest,
  type UnsavedFilesChoice
} from '@/tauri-bridge/save'

const { t } = useI18n()

const show = ref(false)
const files = ref<UnsavedFilesRequest['files']>([])
// The bridge is blocked on this until the user answers; `null` once answered so
// the `@close` that follows a button click cannot answer a second time.
let respond: UnsavedFilesRequest['respond'] | null = null

const handleAsk = (payload: unknown): void => {
  const request = payload as UnsavedFilesRequest
  files.value = request.files
  respond = request.respond
  show.value = true
}

const respondWith = (choice: UnsavedFilesChoice): void => {
  const answer = respond
  respond = null
  show.value = false
  answer?.(choice)
}

onMounted(() => {
  bus.on(UNSAVED_FILES_ASK_EVENT, handleAsk)
})

onBeforeUnmount(() => {
  bus.off(UNSAVED_FILES_ASK_EVENT, handleAsk)
})
</script>

<style scoped>
.file-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  max-height: 180px;
  overflow: auto;
}

.file-list > li {
  line-height: 24px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail {
  margin: 0;
  color: var(--editorColor50);
}
</style>
