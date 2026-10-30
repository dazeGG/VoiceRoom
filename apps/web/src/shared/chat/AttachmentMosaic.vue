<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Attachment } from '@voice-room/shared/contracts/messages';
import { attachmentVariantUrl } from '@/api/attachments';
import AttachmentLightbox from './AttachmentLightbox.vue';

const { attachments = [] } = defineProps<{ attachments?: Attachment[] }>();

const selected = ref(-1);
const ready = computed(() => attachments.filter((attachment) => attachment.state === 'ready'));
const items = computed(() =>
  ready.value.map((attachment) => ({
    src: attachmentVariantUrl(attachment.id, 'processed'),
    downloadHref: attachmentVariantUrl(attachment.id, 'processed', true),
    width: attachment.width ?? undefined,
    height: attachment.height ?? undefined
  }))
);
</script>

<template>
  <div
    v-if="attachments.length"
    class="attachment-mosaic"
    :class="{
      'attachment-mosaic--single': attachments.length === 1,
      'attachment-mosaic--three': attachments.length === 3
    }"
  >
    <template v-for="(attachment, index) in attachments.slice(0, 4)" :key="attachment.id">
      <button
        v-if="attachment.state === 'ready'"
        type="button"
        class="attachment-mosaic__tile"
        :data-attachment-id="attachment.id"
        :aria-label="`Открыть изображение ${index + 1} из ${attachments.length}`"
        :style="{ '--attachment-aspect': `${attachment.width}/${attachment.height}` }"
        @click="selected = ready.findIndex((item) => item.id === attachment.id)"
      >
        <img
          class="attachment-mosaic__image"
          :src="attachment.url || attachmentVariantUrl(attachment.id, 'preview')"
          alt=""
          loading="lazy"
          :width="attachment.width ?? undefined"
          :height="attachment.height ?? undefined"
          decoding="async"
        />
      </button>
      <div
        v-else
        class="attachment-mosaic__tile attachment-mosaic__unavailable"
        role="img"
        aria-label="Изображение недоступно"
      >
        Изображение недоступно
      </div>
    </template>
  </div>

  <AttachmentLightbox v-if="selected >= 0" :items="items" :index="selected" @close="selected = -1" />
</template>
