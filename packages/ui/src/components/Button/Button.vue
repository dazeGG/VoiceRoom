<script setup lang="ts">
import { useTemplateRef } from 'vue';
import Spinner from '../Spinner/Spinner.vue';
import type { ButtonProps } from './types';

withDefaults(defineProps<ButtonProps>(), {
  variant: 'ghost',
  size: 'md',
  type: 'button',
  disabled: false,
  busy: false
});

const button = useTemplateRef<HTMLElement>('button');
defineExpose({ button });

const emit = defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <component
    :is="to && !disabled && !busy ? 'RouterLink' : href || to ? 'a' : 'button'"
    ref="button"
    :class="[
      'ui-button',
      `ui-button--${variant}`,
      `ui-button--size-${size}`,
      {
        'ui-button--fill': fill,
        'ui-button--pill': pill,
        'ui-button--scrim': scrim,
        'ui-button--wrap': wrap,
        'ui-button--start': layout === 'start',
        'ui-button--spaced': layout === 'spaced'
      }
    ]"
    :to="to && !disabled && !busy ? to : undefined"
    :href="href && !disabled && !busy ? href : undefined"
    :type="href || to ? undefined : type"
    :disabled="href || to ? undefined : disabled || busy"
    :aria-disabled="(href || to) && (disabled || busy) ? true : undefined"
    :aria-busy="busy || undefined"
    @click="
      (event: MouseEvent) => {
        if (!disabled && !busy) emit('click', event);
      }
    "
  >
    <span v-if="busy || $slots.icon" class="ui-button__icon">
      <Spinner v-if="busy" :size="size === 'sm' || size === 'md' ? 16 : 20" aria-hidden="true" />
      <slot v-else name="icon" />
    </span>
    <slot />
  </component>
</template>
