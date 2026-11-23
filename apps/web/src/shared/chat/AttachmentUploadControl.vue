<script setup lang="ts">
import { IconButton, DropdownMenu, MenuItem, FileDrop } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { Image as ImageIcon, Plus } from '@lucide/vue';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import type { AttachmentComposeStore } from './attachment-compose';

const { store, disabled } = defineProps<{
  store: AttachmentComposeStore;
  disabled?: boolean;
}>();

const emit = defineEmits<{ error: [message: string] }>();

let closeMenu: ((restoreFocus?: boolean) => void) | undefined;

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
    :disabled="disabled || store.drafts.length >= 4"
    :validate-accept="false"
    @files="void addSelectedFiles($event)"
  >
    <DropdownMenu
      side="top"
      align="start"
      :aria-label="t('Добавить вложение')"
      :disabled="disabled || store.drafts.length >= 4"
    >
      <template #trigger>
        <IconButton :label="t('Добавить вложение')" :size="32">
          <Plus aria-hidden="true" />
        </IconButton>
      </template>
      <template #content="{ close }">
        <MenuItem
          :label="t('Загрузить фото')"
          :disabled="disabled || store.drafts.length >= 4"
          @select.prevent="chooseFile(choose, close)"
        >
          <template #icon><ImageIcon v-bind="iconSm" /></template>
        </MenuItem>
      </template>
    </DropdownMenu>
  </FileDrop>
</template>
