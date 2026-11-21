<script setup lang="ts">
import type { NavListProps } from './types';

defineProps<NavListProps>();
</script>

<template>
  <nav class="ui-nav" :class="{ 'ui-nav--responsive': responsive }" :aria-label="label">
    <slot />
  </nav>
</template>
