<script setup lang="ts">
import { Check, ChevronRight } from '@lucide/vue';
import { iconSm } from '@/shared/ui/icons';
import type { PopoverMenuItemProps } from './types';

withDefaults(defineProps<PopoverMenuItemProps>(), {
  disabled: false,
  variant: 'default',
  selected: false,
  showChevron: false,
  chevronActive: false,
  role: 'menuitem',
  ariaExpanded: undefined
});

defineEmits<{
  click: [event: MouseEvent];
  pointerenter: [event: PointerEvent];
  focus: [event: FocusEvent];
}>();

defineSlots<{ icon?: () => unknown }>();
</script>

<template>
  <button
    class="popover-menu-item"
    :class="[`popover-menu-item--${variant}`, { 'popover-menu-item--selected': selected }]"
    type="button"
    :role="role"
    :disabled="disabled"
    :aria-checked="role === 'option' ? selected : undefined"
    :aria-haspopup="ariaHaspopup"
    :aria-expanded="ariaExpanded"
    :aria-controls="ariaControls"
    @click="$emit('click', $event)"
    @pointerenter="$emit('pointerenter', $event)"
    @focus="$emit('focus', $event)"
  >
    <span v-if="$slots.icon" class="popover-menu-item__icon" aria-hidden="true">
      <slot name="icon" />
    </span>
    <span class="popover-menu-item__label">{{ label }}</span>
    <span v-if="hint" class="popover-menu-item__hint" aria-hidden="true">{{ hint }}</span>
    <span v-if="selected" class="popover-menu-item__check" aria-hidden="true">
      <Check v-bind="iconSm" />
    </span>
    <span
      v-if="showChevron"
      class="popover-menu-item__chevron"
      :class="{ 'popover-menu-item__chevron--active': chevronActive }"
      aria-hidden="true"
    >
      <ChevronRight v-bind="iconSm" />
    </span>
  </button>
</template>
