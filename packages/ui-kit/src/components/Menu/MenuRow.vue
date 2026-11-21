<script setup lang="ts">
import { ChevronRight } from '@lucide/vue';
import type { MenuItemProps } from '../MenuItem/types';

defineProps<Pick<MenuItemProps, 'label' | 'description' | 'shortcut'> & { submenu?: boolean }>();
defineSlots<{
  default?(): unknown;
  indicator?(): unknown;
  icon?(): unknown;
}>();
</script>

<template>
  <span class="ui-menu__indicator" aria-hidden="true"><slot name="indicator" /></span>
  <span v-if="$slots.icon" class="ui-menu__icon" aria-hidden="true"><slot name="icon" /></span>
  <span class="ui-menu__text">
    <slot>{{ label }}</slot>
    <small v-if="description" class="ui-menu__description">{{ description }}</small>
  </span>
  <ChevronRight v-if="submenu" class="ui-menu__chevron" aria-hidden="true" />
  <span v-else-if="shortcut" class="ui-menu__shortcut" aria-hidden="true">{{ shortcut }}</span>
</template>
