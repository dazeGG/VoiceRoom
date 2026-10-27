<script setup lang="ts">
// Plain text with its emoji drawn as the bundled artwork, the way Discord
// draws them. The image keeps the character as its alt text, so selecting
// and copying still yields the emoji. The markup stays on one line: any
// whitespace here would show up inside names and pre-wrapped messages.
import { computed } from 'vue';
import Emoji from './Emoji.vue';
import { splitEmoji } from './emoji-text';

const { text = '', size = '1.375em' } = defineProps<{ text?: string; size?: number | string }>();

const parts = computed(() => splitEmoji(text));
</script>

<template>
  <template v-for="(part, index) in parts" :key="index"
    ><Emoji v-if="part.kind === 'emoji'" :emoji="part.emoji" :size="size" inline /><template v-else>{{
      part.text
    }}</template></template
  >
</template>
