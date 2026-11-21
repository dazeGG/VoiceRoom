<script setup lang="ts">
import { Check, Minus } from '@lucide/vue';
import MenuRow from '../Menu/MenuRow.vue';
import { useMenuParts } from '../Menu/menu-parts';
import type { MenuCheckboxItemProps } from './types';

defineProps<MenuCheckboxItemProps>();
const emit = defineEmits<{ select: [event: Event] }>();
defineSlots<{ default?(): unknown; icon?(): unknown }>();
const checked = defineModel<boolean | 'indeterminate'>({ default: false });
const { CheckboxItem, Indicator } = useMenuParts();
</script>

<template>
  <CheckboxItem
    v-model="checked"
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
        <Indicator><Minus v-if="checked === 'indeterminate'" /><Check v-else /></Indicator>
      </template>
    </MenuRow>
  </CheckboxItem>
</template>
