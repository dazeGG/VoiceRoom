<script setup lang="ts">
import type { BadgeProps } from './types';

withDefaults(defineProps<BadgeProps>(), { tone: 'default' });
</script>

<template>
  <span :class="['ui-badge', `ui-badge--${tone}`]"><slot /></span>
</template>
