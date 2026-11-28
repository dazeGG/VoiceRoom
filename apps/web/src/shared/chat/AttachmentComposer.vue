<script setup lang="ts">
import { FileAttachment, IconButton, Progress, Pressable } from '@voiceroom/ui-kit/components';
import { t } from '@/shared/i18n';
import { Image as ImageIcon, RotateCcw, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import { iconSm } from '@voiceroom/ui-kit/icon-defaults';
import { attachmentVariantUrl } from '@/api/attachments';
import AttachmentLightbox from './AttachmentLightbox.vue';
import type { AttachmentComposeStore } from './attachment-compose';

const { store, disabled } = defineProps<{ store: AttachmentComposeStore; disabled?: boolean }>();

type Draft = AttachmentComposeStore['drafts'][number];

const viewing = ref(-1);

function remove(draft: Draft): void {
  void store.remove(draft);
}

function draftSource(draft: Draft): string {
  return draft.previewUrl || attachmentVariantUrl(draft.id, 'preview');
}

// The moment you most want a closer look at a pasted screenshot is before you
// send it, so a pending image opens in the same viewer a sent one does.
const viewable = computed(() =>
  store.drafts.filter((draft) => draft.kind !== 'diagnostics' && (Boolean(draft.previewUrl) || draft.state === 'ready'))
);
const items = computed(() =>
  viewable.value.map((draft) => ({ src: draftSource(draft), alt: draft.file?.name || t('Изображение') }))
);

function view(draft: Draft): void {
  const index = viewable.value.findIndex((candidate) => candidate.id === draft.id);
  if (index >= 0) viewing.value = index;
}
</script>

<template>
  <section v-if="store.drafts.length" class="attachment-composer" :aria-label="t('Вложения к сообщению')">
    <ol class="attachment-composer__list">
      <li
        v-for="(draft, index) in store.drafts"
        :key="draft.id"
        :class="draft.kind === 'diagnostics' ? 'attachment-composer__file' : 'attachment-composer__draft'"
      >
        <template v-if="draft.kind === 'diagnostics'">
          <FileAttachment
            :name="draft.name ?? draft.file?.name ?? t('Диагностика')"
            :bytes="draft.bytes ?? draft.file?.size ?? 0"
            :url="draft.state === 'ready' ? attachmentVariantUrl(draft.id, 'file') : undefined"
          >
            <template #actions>
              <IconButton :label="t('Удалить файл')" :disabled="disabled || store.busy" @click="remove(draft)">
                <X aria-hidden="true" />
              </IconButton>
            </template>
          </FileAttachment>
          <Progress
            v-if="draft.state !== 'ready'"
            hide-label
            :label="t('Загрузка диагностики')"
            :value="Math.round(draft.progress * 100)"
            :error="Boolean(draft.error) || draft.state === 'failed'"
          />
        </template>
        <template v-else>
          <Pressable
            v-if="draft.previewUrl || draft.state === 'ready'"
            class="attachment-composer__open"
            :aria-label="t('Открыть изображение {p0}', { p0: index + 1 })"
            @click="view(draft)"
          >
            <img :src="draftSource(draft)" :alt="draft.file?.name || t('Изображение {p0}', { p0: index + 1 })" />
          </Pressable>
          <span v-else class="attachment-composer__placeholder"><ImageIcon v-bind="iconSm" aria-hidden="true" /></span>

          <Progress
            v-if="draft.state !== 'ready'"
            class="attachment-composer__loading"
            hide-label
            :label="draft.state === 'processing' ? t('Обработка изображения') : t('Загрузка изображения')"
            :value="draft.state === 'processing' ? null : Math.round(draft.progress * 100)"
            :error="Boolean(draft.error) || draft.state === 'failed'"
          />

          <IconButton
            v-if="draft.error || draft.state === 'failed'"
            class="attachment-composer__retry"
            :label="t('Повторить загрузку')"
            :aria-description="draft.error || t('Не удалось обработать изображение')"
            :disabled="disabled"
            :size="28"
            variant="filled"
            @click="void store.retry(draft)"
          >
            <RotateCcw aria-hidden="true" />
          </IconButton>

          <IconButton
            class="attachment-composer__remove"
            :label="t('Удалить изображение {p0}', { p0: index + 1 })"
            :disabled="disabled"
            :size="24"
            variant="filled"
            @click="remove(draft)"
          >
            <X aria-hidden="true" />
          </IconButton>
        </template>
      </li>
    </ol>
  </section>
  <p v-if="store.lastError" class="attachment-composer__error" role="alert">{{ store.lastError }}</p>

  <AttachmentLightbox v-if="viewing >= 0 && items.length" :items="items" :index="viewing" @close="viewing = -1" />
</template>
