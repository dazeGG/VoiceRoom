<script setup lang="ts">
import { ToolbarRoot } from 'reka-ui';
import type { ToolbarProps } from './types';

defineProps<ToolbarProps>();
</script>

<template>
  <ToolbarRoot class="ui-toolbar" :aria-label="label" loop>
    <slot />
  </ToolbarRoot>
</template>
