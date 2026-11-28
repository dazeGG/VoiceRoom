<script setup lang="ts">
import { IconButton, DropdownMenu, MenuItem, FileDrop } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { FileText, Image as ImageIcon, Plus } from '@lucide/vue';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import type { AttachmentComposeStore } from './attachment-compose';

const {
  store,
  disabled,
  buildDiagnostics = null
} = defineProps<{
  store: AttachmentComposeStore;
  disabled?: boolean;
  buildDiagnostics?: ((signal: AbortSignal) => Promise<File>) | null | undefined;
}>();

const emit = defineEmits<{ error: [message: string] }>();

let closeMenu: ((restoreFocus?: boolean) => void) | undefined;

async function attachDiagnostics(close: () => void): Promise<void> {
  if (!buildDiagnostics) return;
  close();
  try {
    await store.addDiagnostics(buildDiagnostics);
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : t('Не удалось приложить диагностику'));
  }
}

function chooseFile(choose: () => void, close: (restoreFocus?: boolean) => void): void {
  closeMenu = close;
  choose();
}

async function addSelectedFiles(files: File[]): Promise<void> {
  closeMenu?.(false);
  closeMenu = undefined;
  try {
    await store.addFiles(files);
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : t('Не удалось загрузить изображение'));
  }
}
</script>

<template>
  <FileDrop
    v-slot="{ choose }"
    class="attachment-upload"
    variant="trigger"
    accept="image/jpeg,image/png,image/webp"
    multiple
    :disabled="disabled || store.busy || store.drafts.length >= 4"
    :validate-accept="false"
    @files="void addSelectedFiles($event)"
  >
    <DropdownMenu
      side="top"
      align="start"
      :aria-label="t('Добавить вложение')"
      :disabled="disabled || store.busy || store.drafts.length >= 4"
    >
      <template #trigger>
        <IconButton :label="t('Добавить вложение')" :size="32">
          <Plus aria-hidden="true" />
        </IconButton>
      </template>
      <template #content="{ close }">
        <MenuItem
          :label="t('Загрузить фото')"
          :disabled="disabled || store.busy || store.drafts.length >= 4"
          @select.prevent="chooseFile(choose, close)"
        >
          <template #icon><ImageIcon v-bind="iconSm" /></template>
        </MenuItem>
        <MenuItem
          v-if="buildDiagnostics"
          :label="t('Приложить диагностику')"
          :description="t('Версия, система и журнал приложения')"
          @select.prevent="void attachDiagnostics(close)"
        >
          <template #icon><FileText v-bind="iconSm" /></template>
        </MenuItem>
      </template>
    </DropdownMenu>
  </FileDrop>
</template>
