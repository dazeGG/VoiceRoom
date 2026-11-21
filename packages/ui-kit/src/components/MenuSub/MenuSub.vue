<script setup lang="ts">
import { ref } from 'vue';
import MenuRow from '../Menu/MenuRow.vue';
import { useMenuParts, useMenuPortalTarget } from '../Menu/menu-parts';
import type { MenuSubProps } from './types';

defineProps<MenuSubProps>();
defineSlots<{
  icon?(): unknown;
  default(state: { close: () => void }): unknown;
}>();

const open = ref(false);
const { Sub, SubTrigger, SubContent, Portal } = useMenuParts();
const portalTarget = useMenuPortalTarget();

function escape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !(event.currentTarget instanceof HTMLElement)) return;
  if (event.target instanceof Element && event.target.closest('[role="combobox"][aria-expanded="true"]')) return;
  const submenu = event.currentTarget;
  const trigger = document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(submenu.id)}"]`);
  if (!trigger) return;
  event.preventDefault();
  event.stopPropagation();
  open.value = false;
  trigger.focus();
}
</script>

<template>
  <Sub v-model:open="open">
    <SubTrigger
      :disabled="disabled"
      :text-value="label"
      :aria-label="label"
      :aria-description="description"
      :class="['ui-menu__item', tone && `ui-menu__item--${tone}`, { 'ui-menu__item--two-line': description }]"
    >
      <MenuRow :label="label" :description="description" submenu>
        <template v-if="$slots.icon" #icon><slot name="icon" /></template>
      </MenuRow>
    </SubTrigger>
    <Portal :to="portalTarget ?? 'body'">
      <SubContent as-child :collision-padding="8" :side-offset="4" loop @keydown.capture="escape">
        <div
          class="ui-menu ui-menu--panel"
          v-bind="ariaLabel ? { 'aria-label': ariaLabel, 'aria-labelledby': undefined } : {}"
        >
          <slot :close="() => (open = false)" />
        </div>
      </SubContent>
    </Portal>
  </Sub>
</template>
