<script setup lang="ts">
import type { PopoverMenuLabelProps } from './types';

defineProps<PopoverMenuLabelProps>();
</script>

<template>
  <!-- Presentational section heading. Grouping semantics come from the role="group"
       the caller puts around the items, so this stays out of the a11y tree. -->
  <span class="popover-menu-label" aria-hidden="true">{{ text }}</span>
</template>
