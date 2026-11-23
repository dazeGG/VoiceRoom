<script setup lang="ts">
import { ContextMenuContent, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger, ToolbarRoot } from 'reka-ui';
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import { provideMenu } from '../Menu/menu-parts';
import { overlayPortalTarget } from '../overlay-portal-target';
import MenuSeparator from '../MenuSeparator/MenuSeparator.vue';
import type { ContextMenuContentState, ContextMenuProps } from './types';

const EDGE_GAP = 8;

const props = defineProps<ContextMenuProps>();
const emit = defineEmits<{ close: [] }>();
defineSlots<{
  default(state: ContextMenuContentState): unknown;
  header?(state: ContextMenuContentState): unknown;
}>();

const portalTarget = computed(() => overlayPortalTarget(props.restoreFocus));
provideMenu('context', portalTarget);
const panel = shallowRef<HTMLElement | null>(null);
let restoreFocusOnClose = true;

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) restoreFocusOnClose = true;
  }
);

function close(shouldRestoreFocus = true): void {
  restoreFocusOnClose = shouldRestoreFocus;
  emit('close');
}

function onOpenAutoFocus(event: Event): void {
  event.preventDefault();
  void nextTick(() => {
    const first = panel.value?.querySelector<HTMLElement>(
      '[role="toolbar"] button:not([disabled]), :is([role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]):not([aria-disabled="true"])'
    );
    (first ?? panel.value)?.focus({ preventScroll: true });
  });
}

function onCloseAutoFocus(event: Event): void {
  event.preventDefault();
  if (restoreFocusOnClose) props.restoreFocus?.focus();
  restoreFocusOnClose = true;
}

function onInteractOutside(): void {
  restoreFocusOnClose = false;
}

function handleViewportChange(event: Event): void {
  if (event.target instanceof Element && event.target.closest('.ui-menu--panel')) return;
  if (!(event.target instanceof Node) || !panel.value?.contains(event.target)) {
    if (props.open) close();
  }
}

onMounted(() => {
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('scroll', handleViewportChange, { capture: true });
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, { capture: true });
});
</script>

<template>
  <ContextMenuRoot :open="open" :modal="false" @update:open="(value: boolean) => !value && close(restoreFocusOnClose)">
    <Teleport to="body">
      <ContextMenuTrigger
        class="ui-menu__anchor"
        :style="{ left: `${Math.max(EDGE_GAP, x)}px`, top: `${Math.max(EDGE_GAP, y)}px` }"
      />
    </Teleport>

    <ContextMenuPortal :to="portalTarget">
      <ContextMenuContent
        :key="`${x},${y}`"
        as-child
        :collision-padding="EDGE_GAP"
        :side-offset="0"
        side="bottom"
        sticky="always"
        prioritize-position
        loop
        @open-auto-focus="onOpenAutoFocus"
        @close-auto-focus="onCloseAutoFocus"
        @interact-outside="onInteractOutside"
      >
        <div ref="panel" class="ui-menu ui-menu--panel" :aria-label="ariaLabel">
          <template v-if="$slots.header">
            <ToolbarRoot class="ui-menu__header" :aria-label="headerLabel" loop @keydown.esc.stop.prevent="close()">
              <slot name="header" :close="close" />
            </ToolbarRoot>
            <MenuSeparator />
          </template>
          <slot :close="close" />
        </div>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
