<script setup lang="ts">
import { Check } from '@lucide/vue';
import MenuRow from '../Menu/MenuRow.vue';
import { useMenuParts } from '../Menu/menu-parts';
import type { MenuRadioItemProps } from './types';

defineProps<MenuRadioItemProps>();
const emit = defineEmits<{ select: [event: Event] }>();
defineSlots<{ default?(): unknown; icon?(): unknown }>();
const { RadioItem, Indicator } = useMenuParts();
</script>

<template>
  <RadioItem
    :value="value"
    :disabled="disabled"
    :text-value="label"
    :class="['ui-menu__item', tone && `ui-menu__item--${tone}`, { 'ui-menu__item--two-line': description }]"
    :aria-label="label"
    :aria-description="description"
    @select="emit('select', $event)"
  >
    <MenuRow :label="label" :description="description" :shortcut="shortcut">
      <template v-if="$slots.default" #default><slot /></template>
      <template v-if="$slots.icon" #icon><slot name="icon" /></template>
      <template #indicator>
        <Indicator><Check /></Indicator>
      </template>
    </MenuRow>
  </RadioItem>
</template>
