<script setup lang="ts">
import { useId } from 'vue';
import MenuRow from '../Menu/MenuRow.vue';
import { useMenuParts } from '../Menu/menu-parts';
import type { MenuItemProps } from './types';

defineProps<MenuItemProps>();
const emit = defineEmits<{ select: [event: Event] }>();
defineSlots<{ default?(): unknown; icon?(): unknown }>();
const { Item } = useMenuParts();
const descriptionId = useId();
const hintId = useId();
</script>

<template>
  <Item
    :disabled="disabled"
    :text-value="label"
    :class="['ui-menu__item', tone && `ui-menu__item--${tone}`, { 'ui-menu__item--two-line': description }]"
    :aria-label="label"
    :aria-describedby="
      [description && descriptionId, hint && hint !== description && hintId].filter(Boolean).join(' ') || undefined
    "
    @select="emit('select', $event)"
  >
    <MenuRow
      :label="label"
      :description="description"
      :description-id="descriptionId"
      :hint="hint"
      :hint-id="hintId"
      :shortcut="shortcut"
    >
      <template v-if="$slots.default" #default><slot /></template>
      <template v-if="$slots.icon" #icon><slot name="icon" /></template>
    </MenuRow>
  </Item>
</template>
