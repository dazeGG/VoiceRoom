<script setup lang="ts">
import { NETWORK_LABELS, UNKNOWN_LABEL } from './network-bar.ts';
const levels = ['good', 'unstable', 'bad', 'unknown'] as const;
</script>

<template>
  <span class="admin-network-legend">
    <span v-for="level in levels" :key="level" class="admin-network-legend__item">
      <span class="admin-network-dot" :class="`admin-network--${level}`" aria-hidden="true" />
      {{ level === 'unknown' ? UNKNOWN_LABEL : NETWORK_LABELS[level] }}
    </span>
  </span>
</template>
