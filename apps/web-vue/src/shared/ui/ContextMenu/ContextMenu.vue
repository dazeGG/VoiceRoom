<script setup lang="ts">
import { ContextMenuContent, ContextMenuPortal, ContextMenuRoot, ContextMenuTrigger } from 'reka-ui';
import { nextTick, ref, useId } from 'vue';
import type { ContextMenuContentState, ContextMenuProps } from './types';

const EDGE_GAP = 8;

const props = withDefaults(defineProps<ContextMenuProps>(), {
  restoreFocus: null,
  padded: true,
  role: 'menu'
});

const emit = defineEmits<{ close: [] }>();

defineSlots<{ default(state: ContextMenuContentState): unknown }>();

const panel = ref<{ $el: HTMLElement } | null>(null);
const overlayId = `context-menu-${useId()}`;
let restoreFocusOnClose = true;

function close(shouldRestoreFocus = true): void {
  restoreFocusOnClose = shouldRestoreFocus;
  emit('close');
}

function menuItems(): HTMLElement[] {
  const element = panel.value?.$el;
  if (!element) return [];
  const itemRole = props.role === 'listbox' ? 'option' : 'menuitem';
  return [...element.querySelectorAll<HTMLElement>(`[role="${itemRole}"]:not([disabled])`)].filter((item) => {
    const scope = item.parentElement?.closest<HTMLElement>('[role="menu"], [role="listbox"]');
    return scope === element;
  });
}

function focusItem(index: number): void {
  const items = menuItems();
  if (items.length === 0) {
    panel.value?.$el.focus();
    return;
  }
  items[(index + items.length) % items.length]?.focus();
}

function onOpenAutoFocus(event: Event): void {
  event.preventDefault();
  void nextTick(() => focusItem(0));
}

function onCloseAutoFocus(event: Event): void {
  event.preventDefault();
  if (restoreFocusOnClose) props.restoreFocus?.focus();
  restoreFocusOnClose = true;
}

function isInsideOwnedOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  if (panel.value?.$el.contains(target)) return true;
  return target instanceof Element && Boolean(target.closest(`[data-overlay-owner="${overlayId}"]`));
}

// Reka closes on Escape and on a press outside; a press on an overlay this menu
// owns (a submenu) is inside it.
function onPointerDownOutside(event: CustomEvent<{ originalEvent: PointerEvent }>): void {
  if (isInsideOwnedOverlay(event.detail.originalEvent.target)) {
    event.preventDefault();
    return;
  }
  restoreFocusOnClose = false;
}

function onFocusOutside(event: CustomEvent<{ originalEvent: FocusEvent }>): void {
  if (isInsideOwnedOverlay(event.detail.originalEvent.target)) event.preventDefault();
  else restoreFocusOnClose = false;
}

function onKeydown(event: KeyboardEvent): void {
  const items = menuItems();
  const currentIndex = items.findIndex((item) => item === document.activeElement);
  const active = document.activeElement;
  const activeElement = active instanceof HTMLElement ? active : null;
  const ownsNavigation = Boolean(
    activeElement?.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="slider"], [role="grid"], [role="tablist"]'
    )
  );
  const activeScope = activeElement?.parentElement?.closest<HTMLElement>('[role="menu"], [role="listbox"]');

  if (props.role === 'dialog' || ownsNavigation || (activeScope && activeScope !== panel.value?.$el)) {
    return;
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusItem(currentIndex < 0 ? 0 : currentIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusItem(currentIndex < 0 ? items.length - 1 : currentIndex - 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    focusItem(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    focusItem(items.length - 1);
  }
}
</script>

<template>
  <ContextMenuRoot :open="open" :modal="false" @update:open="(value: boolean) => !value && close(restoreFocusOnClose)">
    <!-- Reka anchors the menu to its trigger: an empty 0x0 box at the requested point. -->
    <ContextMenuTrigger as-child>
      <span class="context-menu__anchor" :style="{ left: `${x}px`, top: `${y}px` }"></span>
    </ContextMenuTrigger>

    <ContextMenuPortal>
      <ContextMenuContent
        ref="panel"
        class="context-menu__panel"
        :class="{ 'context-menu__panel--bare': !padded }"
        data-context-menu
        :data-overlay-id="overlayId"
        :role="role"
        :aria-label="ariaLabel"
        tabindex="-1"
        side="bottom"
        align="start"
        :side-offset="0"
        :avoid-collisions="true"
        :collision-padding="EDGE_GAP"
        @open-auto-focus="onOpenAutoFocus"
        @close-auto-focus="onCloseAutoFocus"
        @pointer-down-outside="onPointerDownOutside"
        @focus-outside="onFocusOutside"
        @keydown="onKeydown"
      >
        <div class="context-menu__inner">
          <slot :close="close" />
        </div>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
