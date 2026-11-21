<script setup lang="ts">
import { computed } from 'vue';

import type { EllipsisProps } from './types';

const props = withDefaults(defineProps<EllipsisProps>(), { text: '', inline: false, tag: 'span' });

const resolvedTitle = computed(() => props.title ?? props.text);
</script>

<template>
  <component :is="tag" :class="['ellipsis', { 'ellipsis--inline': inline }]" :title="resolvedTitle || undefined">
    <slot>{{ text }}</slot>
  </component>
</template>
