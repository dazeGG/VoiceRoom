<script setup lang="ts">
import EmojiText from './EmojiText.vue';

defineProps<{ label: string }>();
</script>

<template>
  <!-- Always in the tree, so a screen reader hears the line change instead of
       meeting a live region that only appears together with its first text.
       Names in it may carry emoji, drawn like everywhere else. -->
  <p class="typing-indicator" aria-live="polite"><EmojiText :text="label" /></p>
</template>
