<script setup lang="ts">
import type { SafetyCodeProps } from './types';

defineProps<SafetyCodeProps>();
</script>

<template>
  <ol class="ui-safety-code" :aria-label="label">
    <li v-for="(item, index) in items" :key="index" class="ui-safety-code__item">
      <span class="ui-safety-code__emoji" aria-hidden="true">{{ item.emoji }}</span>
      <span class="ui-safety-code__name">{{ item.name }}</span>
    </li>
  </ol>
</template>
