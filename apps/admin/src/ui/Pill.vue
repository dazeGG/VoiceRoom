<script setup lang="ts">
import { Tag } from '@voiceroom/ui-kit/components';
import type { Tone } from './types.ts';

withDefaults(defineProps<{ tone?: Tone; dot?: boolean; compact?: boolean }>(), { tone: 'neutral' });
</script>

<template>
  <Tag class="admin-pill" :class="'admin-tone--' + tone" :size="compact ? 'sm' : 'md'">
    <span v-if="dot" class="admin-pill__dot" aria-hidden="true" /><slot />
  </Tag>
</template>
