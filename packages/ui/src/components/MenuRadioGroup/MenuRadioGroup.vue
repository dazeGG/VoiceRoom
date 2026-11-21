<script setup lang="ts">
import type { AcceptableValue } from 'reka-ui';
import { useMenuParts } from '../Menu/menu-parts';
import type { MenuRadioGroupProps } from './types';

defineProps<MenuRadioGroupProps>();
defineSlots<{ default(): unknown }>();
const value = defineModel<string>();
const { RadioGroup } = useMenuParts();

function select(next: AcceptableValue): void {
  if (typeof next === 'string') value.value = next;
}
</script>

<template>
  <RadioGroup
    v-bind="value === undefined ? {} : { modelValue: value }"
    :aria-label="ariaLabel"
    @update:model-value="select"
    ><slot
  /></RadioGroup>
</template>
