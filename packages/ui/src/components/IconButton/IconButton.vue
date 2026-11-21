<script setup lang="ts">
import Tooltip from '../Tooltip/Tooltip.vue';
import type { IconButtonProps } from './types';

defineOptions({ inheritAttrs: false });

withDefaults(defineProps<IconButtonProps>(), {
  size: 32,
  variant: 'default',
  tooltip: true,
  disabled: false,
  type: 'button'
});

const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <Tooltip v-if="tooltip" :text="label" :shortcut="shortcut">
    <button
      v-bind="$attrs"
      :class="['ui-icon-button', `ui-icon-button--${variant}`, `ui-icon-button--size-${size}`]"
      :type="type"
      :disabled="disabled"
      :aria-label="label"
      @click="emit('click', $event)"
    >
      <slot />
    </button>
  </Tooltip>
  <button
    v-else
    v-bind="$attrs"
    :class="['ui-icon-button', `ui-icon-button--${variant}`, `ui-icon-button--size-${size}`]"
    :type="type"
    :disabled="disabled"
    :aria-label="label"
    @click="emit('click', $event)"
  >
    <slot />
  </button>
</template>
