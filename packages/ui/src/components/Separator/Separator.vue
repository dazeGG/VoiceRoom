<script setup lang="ts">
import { Separator as RekaSeparator } from 'reka-ui';
import type { SeparatorProps } from './types';

withDefaults(defineProps<SeparatorProps>(), { orientation: 'horizontal', decorative: false });
</script>

<template>
  <RekaSeparator
    class="ui-separator"
    :class="`ui-separator--${orientation}`"
    :orientation="orientation"
    :decorative="decorative"
  >
    <slot />
  </RekaSeparator>
</template>
