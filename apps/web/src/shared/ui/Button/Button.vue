<script setup lang="ts">
import type { ButtonProps } from './types';

withDefaults(defineProps<ButtonProps>(), { variant: 'ghost', size: 'md', type: 'button', disabled: false });
</script>

<template>
  <button :class="['ui-button', `ui-button--${variant}`, `ui-button--size-${size}`]" :type="type" :disabled="disabled">
    <span v-if="$slots.icon" class="ui-button__icon"><slot name="icon" /></span>
    <slot />
  </button>
</template>
