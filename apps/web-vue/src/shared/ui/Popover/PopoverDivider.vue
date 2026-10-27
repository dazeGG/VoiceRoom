<script setup lang="ts">
import type { PopoverDividerProps } from './types';

withDefaults(defineProps<PopoverDividerProps>(), { tight: false });
</script>

<template>
  <div class="popover-divider" :class="{ 'popover-divider--tight': tight }" role="separator"></div>
</template>
