<script setup lang="ts">
import Pressable from '../Pressable/Pressable.vue';
import type { TagCountProps } from './types';

defineProps<TagCountProps>();
</script>

<template>
  <Pressable display="inline-flex" class="ui-tag__count-action" :aria-label="label">{{ count }}</Pressable>
</template>
