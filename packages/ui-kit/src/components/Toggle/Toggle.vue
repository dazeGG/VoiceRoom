<script setup lang="ts">
import { Toggle as RekaToggle } from 'reka-ui';
import type { ToggleProps } from './types';

withDefaults(defineProps<ToggleProps>(), { size: 'sm', tone: 'default', disabled: false });

const pressed = defineModel<boolean>('pressed', { default: false });
</script>

<template>
  <RekaToggle
    v-model="pressed"
    :class="['ui-toggle', `ui-toggle--size-${size}`, `ui-toggle--tone-${tone}`]"
    :disabled="disabled"
  >
    <slot />
  </RekaToggle>
</template>
