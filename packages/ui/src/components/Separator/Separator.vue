<script setup lang="ts">
import { Separator as RekaSeparator } from 'reka-ui';
import type { SeparatorProps } from './types';

withDefaults(defineProps<SeparatorProps>(), { orientation: 'horizontal', decorative: false });
</script>

<template>
  <RekaSeparator
    :class="variant === 'resize' ? 'ui-separator--resize' : ['ui-separator', 'ui-separator--' + orientation]"
    :orientation="orientation"
    :decorative="decorative"
  >
    <slot />
  </RekaSeparator>
</template>
