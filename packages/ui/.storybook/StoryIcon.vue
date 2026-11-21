<script setup lang="ts">
import { Bold, Mic, Plus, ThumbsDown, ThumbsUp } from '@lucide/vue';

defineProps<{ name: 'bold' | 'mic' | 'plus' | 'thumbs-down' | 'thumbs-up' }>();

const icons = {
  bold: Bold,
  mic: Mic,
  plus: Plus,
  'thumbs-down': ThumbsDown,
  'thumbs-up': ThumbsUp
};
</script>

<template>
  <component :is="icons[name]" aria-hidden="true" />
</template>
