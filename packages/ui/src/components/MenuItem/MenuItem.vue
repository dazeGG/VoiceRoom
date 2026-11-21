<script setup lang="ts">
import MenuRow from '../Menu/MenuRow.vue';
import { useMenuParts } from '../Menu/menu-parts';
import type { MenuItemProps } from './types';

defineProps<MenuItemProps>();
const emit = defineEmits<{ select: [event: Event] }>();
defineSlots<{ default?(): unknown; icon?(): unknown }>();
const { Item } = useMenuParts();
</script>

<template>
  <Item
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
    </MenuRow>
  </Item>
</template>
