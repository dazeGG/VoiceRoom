<script setup lang="ts">
import { Bold, KeyRound, Mic, Plus, Search, ThumbsDown, ThumbsUp } from '@lucide/vue';

defineProps<{ name: 'bold' | 'key-round' | 'mic' | 'plus' | 'search' | 'thumbs-down' | 'thumbs-up' }>();

const icons = {
  bold: Bold,
  'key-round': KeyRound,
  mic: Mic,
  plus: Plus,
  search: Search,
  'thumbs-down': ThumbsDown,
  'thumbs-up': ThumbsUp
};
</script>

<template>
  <component :is="icons[name]" aria-hidden="true" />
</template>
