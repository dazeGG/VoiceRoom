<script setup lang="ts">
import Spinner from '../Spinner/Spinner.vue';
import type { ButtonProps } from './types';

withDefaults(defineProps<ButtonProps>(), {
  variant: 'ghost',
  size: 'md',
  type: 'button',
  disabled: false,
  busy: false
});

const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button
    :class="['ui-button', `ui-button--${variant}`, `ui-button--size-${size}`]"
    :type="type"
    :disabled="disabled || busy"
    :aria-busy="busy || undefined"
    @click="emit('click', $event)"
  >
    <span v-if="busy || $slots.icon" class="ui-button__icon">
      <Spinner v-if="busy" :size="size === 'sm' || size === 'md' ? 16 : 20" aria-hidden="true" />
      <slot v-else name="icon" />
    </span>
    <slot />
  </button>
</template>
