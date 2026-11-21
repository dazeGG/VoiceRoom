<script setup lang="ts">
import { Primitive } from 'reka-ui';
import type { PressableProps } from './types';

const props = withDefaults(defineProps<PressableProps>(), { display: 'block' });

function guardDisabled(event: MouseEvent): void {
  if (props.asChild && props.disabled) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
</script>

<template>
  <Primitive
    as="button"
    :as-child="asChild"
    :type="asChild ? undefined : 'button'"
    :disabled="asChild ? undefined : disabled"
    :aria-disabled="asChild && disabled ? true : undefined"
    :tabindex="asChild && disabled ? -1 : undefined"
    class="ui-pressable"
    :class="['ui-pressable--' + display, { 'ui-pressable--inset': inset, 'ui-pressable--hoverable': hoverable }]"
    @click.capture="guardDisabled"
  >
    <slot />
  </Primitive>
</template>
