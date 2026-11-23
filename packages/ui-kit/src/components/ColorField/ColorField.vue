<script setup lang="ts">
import { useFieldControl } from '../Field/context';
import type { ColorFieldProps } from './types';

defineOptions({ inheritAttrs: false });
defineProps<ColorFieldProps>();
const value = defineModel<string>({ required: true });
const controlAttrs = useFieldControl();
</script>

<template>
  <input
    v-bind="{
      ...controlAttrs({ ...$attrs, 'aria-label': label || $attrs['aria-label'] }),
      ...(secondary ? { id: typeof $attrs.id === 'string' ? $attrs.id : undefined } : {})
    }"
    v-model="value"
    class="ui-color-field"
    type="color"
    :disabled="disabled"
  />
</template>
