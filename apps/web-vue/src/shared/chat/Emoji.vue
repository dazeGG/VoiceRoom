<script setup lang="ts">
// One emoji, drawn from the bundled Twemoji artwork so it looks the same on
// every OS — see emoji-asset.ts for why the platform font is not enough. The
// character itself stays the alt text, so selecting, copying and screen
// readers all still see an emoji rather than a picture of one, and a failed
// image load falls back to it.
import { computed, ref } from 'vue';
import { emojiAssetUrl } from './emoji-asset';

const {
  emoji,
  size = 22,
  decorative,
  inline
} = defineProps<{
  emoji: string;
  /** Rendered box: px as a number, or any CSS length such as '1.375em'. */
  size?: number | string;
  /** True when a parent already names this emoji, e.g. in its aria-label. */
  decorative?: boolean;
  /** Sits in running text, sized and aligned against the surrounding line. */
  inline?: boolean;
}>();

const url = computed(() => emojiAssetUrl(emoji));
// A different emoji deserves a fresh attempt at its own file.
const failedUrl = ref<string | null>(null);
const failed = computed(() => failedUrl.value === url.value);
const box = computed(() => (typeof size === 'number' ? `${size}px` : size));
</script>

<template>
  <span
    v-if="failed"
    class="emoji emoji--text"
    :class="{ 'emoji--inline': inline }"
    :style="{ '--emoji-size': box }"
    :aria-hidden="decorative || undefined"
    >{{ emoji }}</span
  >
  <img
    v-else
    class="emoji"
    :class="{ 'emoji--inline': inline }"
    :style="{ '--emoji-size': box }"
    :src="url"
    :alt="decorative ? '' : emoji"
    :data-emoji="emoji"
    draggable="false"
    loading="lazy"
    decoding="async"
    @error="failedUrl = url"
  />
</template>
