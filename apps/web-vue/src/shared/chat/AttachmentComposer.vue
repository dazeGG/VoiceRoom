<script setup lang="ts">
import { Image as ImageIcon, LoaderCircle, RotateCcw, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import { iconSm } from '@/shared/ui/icons';
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
const viewable = computed(() => store.drafts.filter((draft) => Boolean(draft.previewUrl) || draft.state === 'ready'));
const items = computed(() =>
  viewable.value.map((draft) => ({ src: draftSource(draft), alt: draft.file?.name || 'Изображение' }))
);

function view(draft: Draft): void {
  const index = viewable.value.findIndex((candidate) => candidate.id === draft.id);
  if (index >= 0) viewing.value = index;
}
</script>

<template>
  <section v-if="store.drafts.length" class="attachment-composer" aria-label="Изображения к сообщению">
    <ol class="attachment-composer__list">
      <li
        v-for="(draft, index) in store.drafts"
        :key="draft.id"
        class="attachment-composer__draft"
        :class="`attachment-composer__draft--${draft.error ? 'failed' : draft.state}`"
      >
        <button
          v-if="draft.previewUrl || draft.state === 'ready'"
          class="attachment-composer__open"
          type="button"
          :aria-label="`Открыть изображение ${index + 1}`"
          @click="view(draft)"
        >
          <img :src="draftSource(draft)" :alt="draft.file?.name || `Изображение ${index + 1}`" />
        </button>
        <span v-else class="attachment-composer__placeholder"><ImageIcon v-bind="iconSm" aria-hidden="true" /></span>

        <span
          v-if="draft.state !== 'ready' && !draft.error"
          class="attachment-composer__loading"
          :style="{ '--attachment-progress': `${Math.round(draft.progress * 100)}%` }"
          role="status"
          :aria-label="
            draft.state === 'processing'
              ? 'Обработка изображения'
              : `Загрузка изображения ${Math.round(draft.progress * 100)}%`
          "
        >
          <LoaderCircle v-bind="iconSm" aria-hidden="true" />
        </span>

        <button
          v-if="draft.error || draft.state === 'failed'"
          class="attachment-composer__retry"
          type="button"
          aria-label="Повторить загрузку"
          :title="draft.error || 'Не удалось обработать изображение'"
          :disabled="disabled"
          @click="void store.retry(draft)"
        >
          <RotateCcw v-bind="iconSm" aria-hidden="true" />
        </button>

        <button
          class="attachment-composer__remove"
          type="button"
          :aria-label="`Удалить изображение ${index + 1}`"
          :disabled="disabled"
          @click="remove(draft)"
        >
          <X v-bind="iconSm" aria-hidden="true" />
        </button>
      </li>
    </ol>
  </section>
  <p v-if="store.lastError" class="attachment-composer__error" role="alert">{{ store.lastError }}</p>

  <AttachmentLightbox v-if="viewing >= 0 && items.length" :items="items" :index="viewing" @close="viewing = -1" />
</template>
