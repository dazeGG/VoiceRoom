<script setup lang="ts">
import type { SkeletonProps } from './types';

withDefaults(defineProps<SkeletonProps>(), {
  width: '100%',
  height: 'var(--size-16)',
  radius: 'var(--radius-6)',
  circle: false
});
</script>

<template>
  <span
    :class="['ui-skeleton', { 'ui-skeleton--circle': circle }]"
    :style="{ width, height, borderRadius: circle ? undefined : radius }"
    aria-hidden="true"
  ></span>
</template>
