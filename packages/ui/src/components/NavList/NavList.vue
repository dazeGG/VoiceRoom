<script setup lang="ts">
import type { NavListProps } from './types';

defineProps<NavListProps>();
</script>

<template>
  <nav class="ui-nav" :aria-label="label">
    <slot />
  </nav>
</template>
