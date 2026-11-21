<script setup lang="ts">
import type { ControlGroupProps } from './types';

defineProps<ControlGroupProps>();
</script>

<template>
  <div class="ui-segment" role="group" :aria-label="label">
    <slot />
  </div>
</template>
