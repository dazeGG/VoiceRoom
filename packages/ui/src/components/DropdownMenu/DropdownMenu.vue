<script setup lang="ts">
import { DropdownMenuContent, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger } from 'reka-ui';
import { computed, nextTick, shallowRef, useTemplateRef } from 'vue';
import { provideMenu } from '../Menu/menu-parts';
import { overlayPortalTarget } from '../overlay-portal-target';
import type { DropdownMenuContentState, DropdownMenuProps } from './types';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<DropdownMenuProps>(), { side: 'bottom', align: 'end' });
defineSlots<{
  trigger(): unknown;
  content(state: DropdownMenuContentState): unknown;
}>();

const open = defineModel<boolean>('open', { default: false });
const trigger = useTemplateRef<InstanceType<typeof DropdownMenuTrigger>>('trigger');
const portalTarget = computed(() => overlayPortalTarget(trigger.value?.$el));
provideMenu('dropdown', portalTarget);
const panel = shallowRef<HTMLElement | null>(null);
let restoreFocusOnClose = true;

function close(restoreFocus = true): void {
  if (!open.value) return;
  restoreFocusOnClose = restoreFocus;
  open.value = false;
}

function onOpenAutoFocus(event: Event): void {
  if (!props.focusChecked) return;
  event.preventDefault();
  void nextTick(() => {
    const item = panel.value?.querySelector<HTMLElement>(
      '[role="menuitemradio"][aria-checked="true"]:not([aria-disabled="true"])'
    );
    (item ?? panel.value)?.focus({ preventScroll: true });
  });
}

function onCloseAutoFocus(event: Event): void {
  if (!restoreFocusOnClose) event.preventDefault();
  restoreFocusOnClose = true;
}
</script>

<template>
  <DropdownMenuRoot v-model:open="open" :modal="false">
    <DropdownMenuTrigger ref="trigger" as-child :disabled="disabled"><slot name="trigger" /></DropdownMenuTrigger>
    <DropdownMenuPortal :to="portalTarget">
      <DropdownMenuContent
        as-child
        :side="side"
        :align="align"
        :aria-label="ariaLabel"
        :side-offset="4"
        :collision-padding="8"
        loop
        @open-auto-focus="onOpenAutoFocus"
        @close-auto-focus="onCloseAutoFocus"
      >
        <div
          ref="panel"
          class="ui-menu ui-menu--panel"
          v-bind="{ ...$attrs, ...(ariaLabel ? { 'aria-labelledby': undefined } : {}) }"
        >
          <slot name="content" :close="close" />
        </div>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
