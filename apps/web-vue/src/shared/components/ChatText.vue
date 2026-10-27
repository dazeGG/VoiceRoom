<script setup lang="ts">
import { computed } from 'vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { parseChatLinks } from '@/shared/utils/linkify';

const props = withDefaults(defineProps<{ text?: string }>(), { text: '' });

const segments = computed(() => parseChatLinks(props.text));
</script>

<template>
  <template v-for="(seg, i) in segments" :key="i">
    <a
      v-if="seg.kind === 'link' && seg.href"
      class="chat-text__link"
      :href="seg.href"
      target="_blank"
      rel="noopener noreferrer nofollow external"
      >{{ seg.text }}</a
    >
    <EmojiText v-else :text="seg.text" />
  </template>
</template>
