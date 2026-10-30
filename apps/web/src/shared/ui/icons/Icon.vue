<script setup lang="ts">
// A Font Awesome brand icon (data from @fortawesome/free-brands-svg-icons) as an
// inline SVG; replaces svelte-fa. `size` matches Fa's "sm" and "lg".
import type { IconDefinition } from '@fortawesome/free-brands-svg-icons';
import { computed } from 'vue';

const props = withDefaults(defineProps<{ icon: IconDefinition; size?: '1x' | 'sm' | 'lg' }>(), { size: '1x' });

const width = computed(() => props.icon.icon[0]);
const height = computed(() => props.icon.icon[1]);
const paths = computed(() => [props.icon.icon[4]].flat());
</script>

<template>
  <svg
    :class="['icon', `icon--${size}`]"
    xmlns="http://www.w3.org/2000/svg"
    :viewBox="`0 0 ${width} ${height}`"
    aria-hidden="true"
  >
    <path v-for="(d, index) in paths" :key="index" fill="currentColor" :d="d" />
  </svg>
</template>
