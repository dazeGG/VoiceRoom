<script setup lang="ts">
import { useFieldControl } from '../Field/context';
import type { NativeSelectProps } from './types';

defineOptions({ inheritAttrs: false });
const props = withDefaults(defineProps<NativeSelectProps>(), { options: () => [], size: 'md' });
const value = defineModel<string>({ default: '' });
const emit = defineEmits<{ valueChange: [value: string] }>();
const controlAttrs = useFieldControl();

function choose(event: Event): void {
  if (props.disabled || !(event.currentTarget instanceof HTMLSelectElement)) return;
  const next = event.currentTarget.value;
  if (next === value.value) return;
  value.value = next;
  emit('valueChange', next);
}
</script>

<template>
  <select
    v-bind="controlAttrs({ ...$attrs, 'aria-label': label || $attrs['aria-label'] })"
    :class="[
      'ui-select',
      'ui-select--' + size,
      { 'ui-select--ghost': variant === 'ghost', 'ui-select--icon-only': iconOnly }
    ]"
    :value="value"
    :name="name"
    :disabled="disabled || options.length === 0"
    @change="choose"
  >
    <option v-for="option in options" :key="option.value" :value="option.value" :lang="option.lang">
      {{ option.label }}
    </option>
  </select>
</template>
