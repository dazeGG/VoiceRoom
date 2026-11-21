<script setup lang="ts">
import { IconButton } from '@voice-room/ui/components';
import { t } from '@/shared/i18n';
import { Image as ImageIcon, Plus } from '@lucide/vue';
import { ref } from 'vue';
import { DropdownMenu, MenuItem } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
import type { AttachmentComposeStore } from './attachment-compose';

const { store, disabled } = defineProps<{
  store: AttachmentComposeStore;
  disabled?: boolean;
}>();

const emit = defineEmits<{ error: [message: string] }>();

const input = ref<HTMLInputElement | null>(null);

let closeMenu: ((restoreFocus?: boolean) => void) | undefined;

function chooseFile(close: (restoreFocus?: boolean) => void): void {
  closeMenu = close;
  input.value?.click();
}

async function addSelectedFiles(): Promise<void> {
  const files = input.value?.files;
  if (!files?.length) return;
  closeMenu?.(false);
  closeMenu = undefined;
  try {
    await store.addFiles(files);
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : t('Не удалось загрузить изображение'));
  } finally {
    if (input.value) input.value.value = '';
  }
}
</script>

<template>
  <div class="attachment-upload">
    <input
      ref="input"
      class="attachment-upload__input"
      type="file"
      accept="image/jpeg,image/png,image/webp"
      multiple
      tabindex="-1"
      aria-hidden="true"
      @change="void addSelectedFiles()"
    />
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
          @select.prevent="chooseFile(close)"
        >
          <template #icon><ImageIcon v-bind="iconSm" /></template>
        </MenuItem>
      </template>
    </DropdownMenu>
  </div>
</template>
