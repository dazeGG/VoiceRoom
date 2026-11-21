<script setup lang="ts">
import type { CardProps } from './types';

withDefaults(defineProps<CardProps>(), { as: 'div' });
</script>

<template>
  <component :is="as" class="ui-card"><slot /></component>
</template>
