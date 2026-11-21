<script setup lang="ts">
import type { KbdProps } from './types';

defineProps<KbdProps>();
</script>

<template>
  <span class="ui-kbd-group">
    <kbd v-for="(key, index) in keys" :key="index" class="ui-kbd">{{ key }}</kbd>
  </span>
</template>
