<script setup lang="ts">
import { Image as ImageIcon, Plus } from '@lucide/vue';
import { ref } from 'vue';
import { Popover, PopoverMenuItem } from '@/shared/ui';
import type { PopoverContentState, PopoverTriggerState } from '@/shared/ui';
import { iconSm } from '@/shared/ui/icons';
import type { AttachmentComposeStore } from './attachment-compose';

const { store, disabled } = defineProps<{
  store: AttachmentComposeStore;
  disabled?: boolean;
}>();

const emit = defineEmits<{ error: [message: string] }>();

const input = ref<HTMLInputElement | null>(null);

async function addSelectedFiles(close: (restoreFocus?: boolean) => void): Promise<void> {
  const files = input.value?.files;
  if (!files?.length) return;
  close(false);
  try {
    await store.addFiles(files);
  } catch (cause) {
    emit('error', cause instanceof Error ? cause.message : 'Не удалось загрузить изображение');
  } finally {
    if (input.value) input.value.value = '';
  }
}
</script>

<template>
  <Popover
    placement="top-start"
    role="menu"
    aria-label="Добавить вложение"
    root-class="attachment-upload"
    panel-class="attachment-upload__popover"
    keep-content-mounted
  >
    <template #trigger="{ toggle, panelId, open }: PopoverTriggerState">
      <button
        class="attachment-upload__button"
        type="button"
        aria-label="Добавить вложение"
        aria-haspopup="menu"
        :aria-controls="panelId"
        :aria-expanded="open"
        :disabled="disabled || store.drafts.length >= 4"
        @click="toggle"
      >
        <Plus v-bind="iconSm" aria-hidden="true" />
      </button>
    </template>
    <template #content="{ close }: PopoverContentState">
      <input
        ref="input"
        class="attachment-upload__input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        tabindex="-1"
        aria-hidden="true"
        @change="void addSelectedFiles(close)"
      />
      <PopoverMenuItem label="Загрузить фото" :disabled="disabled || store.drafts.length >= 4" @click="input?.click()">
        <template #icon><ImageIcon v-bind="iconSm" /></template>
      </PopoverMenuItem>
    </template>
  </Popover>
</template>
