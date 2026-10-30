<script setup lang="ts">
import { computed } from 'vue';
import { linkPreviewImageUrl, type LinkPreview } from '@voice-room/shared/link-preview';
import EmojiText from './EmojiText.vue';

const { preview } = defineProps<{ preview: LinkPreview }>();

// The image is the copy the server stored, never the linked site's own file.
const imageUrl = computed(() => (preview.image ? linkPreviewImageUrl(preview.image.key) : null));
</script>

<template>
  <!-- A compact card that sits under the message rather than taking it over: the
       picture as a thumbnail on the left, and on the right the site, a one-line
       title and at most two lines of description. -->
  <a
    class="link-preview"
    :class="{ 'link-preview--with-image': Boolean(imageUrl) }"
    :href="preview.url"
    target="_blank"
    rel="noopener noreferrer nofollow external"
  >
    <span v-if="imageUrl && preview.image" class="link-preview__thumb">
      <img
        class="link-preview__image"
        :src="imageUrl"
        alt=""
        :width="preview.image.width"
        :height="preview.image.height"
        loading="lazy"
        decoding="async"
      />
    </span>
    <span class="link-preview__text">
      <span class="link-preview__site"><EmojiText :text="preview.siteName" /></span>
      <strong v-if="preview.title" class="link-preview__title"><EmojiText :text="preview.title" /></strong>
      <span v-if="preview.description" class="link-preview__description"
        ><EmojiText :text="preview.description"
      /></span>
    </span>
  </a>
</template>
