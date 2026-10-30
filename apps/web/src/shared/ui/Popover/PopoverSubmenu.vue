<script setup lang="ts">
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui';
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import PopoverMenuItem from './PopoverMenuItem.vue';
import type { PopoverSubmenuProps } from './types';

// Long enough that a pointer crossing the row on its way elsewhere does not
// flash the panel, short enough to feel immediate when you actually stop.
const HOVER_DELAY_MS = 120;

const props = withDefaults(defineProps<PopoverSubmenuProps>(), { disabled: false });

defineSlots<{
  icon?: () => unknown;
  default(state: { close: () => void }): unknown;
}>();

const open = ref(false);
const row = ref<HTMLDivElement | null>(null);
const panel = ref<HTMLDivElement | null>(null);
const side = ref<'left' | 'right'>('right');
const overlayOwner = ref<string | undefined>(undefined);
let focusOnOpen = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const panelId = `popover-submenu-${useId()}`;

function openPanel(focus = false): void {
  overlayOwner.value = row.value?.closest<HTMLElement>('[data-overlay-id]')?.dataset.overlayId;
  focusOnOpen = focus;
  open.value = true;
}

function triggerButton(): HTMLButtonElement | null {
  return row.value?.querySelector(':scope > button') ?? null;
}

function panelItems(): HTMLElement[] {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []);
}

// Reka flips the panel to the left when the right has no room; the hover bridge
// in the stylesheet follows the side it placed the panel on.
function syncSide(): void {
  side.value = panel.value?.dataset.side === 'left' ? 'left' : 'right';
}

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    void nextTick(() => {
      syncSide();
      if (focusOnOpen) panelItems()[0]?.focus();
    });
    requestAnimationFrame(syncSide);
  },
  { flush: 'post' }
);

function skipAutoFocus(event: Event): void {
  event.preventDefault();
}

function cancelTimer(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

function scheduleOpen(): void {
  if (props.disabled || open.value) return;
  cancelTimer();
  timer = setTimeout(() => {
    timer = null;
    openPanel();
  }, HOVER_DELAY_MS);
}

function close(): void {
  cancelTimer();
  open.value = false;
}

function closeAndFocusTrigger(): void {
  close();
  triggerButton()?.focus();
}

function toggle(): void {
  cancelTimer();
  if (open.value) open.value = false;
  else openPanel();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowRight' && !open.value) {
    event.preventDefault();
    event.stopPropagation();
    openPanel(true);
  } else if (event.key === 'ArrowLeft' && open.value) {
    event.preventDefault();
    event.stopPropagation();
    closeAndFocusTrigger();
  }
}

function handlePanelKeydown(event: KeyboardEvent): void {
  const items = panelItems();
  const current = items.findIndex((item) => item === document.activeElement);
  let next: number;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    event.stopPropagation();
    closeAndFocusTrigger();
    return;
  }
  if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
  else if (event.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = items.length - 1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  items[next]?.focus();
}

// Escape closes only the submenu; the parent popover sees the submenu panel and
// leaves the key alone, so it keeps its Escape for the next press.
function handleEscape(event: KeyboardEvent): void {
  event.preventDefault();
  closeAndFocusTrigger();
}

// Leaving the row for anywhere outside the row+panel pair closes it. The CSS
// bridge in the stylesheet keeps the diagonal travel to the panel inside that pair.
function handlePointerLeave(event: PointerEvent): void {
  cancelTimer();
  const next = event.relatedTarget;
  if (next instanceof Node && (row.value?.contains(next) || panel.value?.contains(next))) return;
  open.value = false;
}

function handlePanelPointerLeave(event: PointerEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && (panel.value?.contains(next) || row.value?.contains(next))) return;
  close();
}

// The parent menu stays usable while the submenu is up, so only Escape, the
// pointer leaving and ArrowLeft close it.
function keepOpen(event: Event): void {
  event.preventDefault();
}

onBeforeUnmount(cancelTimer);
</script>

<template>
  <PopoverRoot :open="open" :modal="false">
    <!-- The group is a hover region, not a control: pointer handlers implement the
         open-on-dwell bridge, and the keydown handler only catches ArrowLeft/Right
         bubbling up from the real button inside it. -->
    <PopoverAnchor as-child>
      <div
        ref="row"
        class="popover-submenu"
        :class="{ 'popover-submenu--left': side === 'left' }"
        role="group"
        @pointerenter="scheduleOpen"
        @pointerleave="handlePointerLeave"
        @keydown="handleKeydown"
      >
        <PopoverMenuItem
          :label="label"
          :disabled="disabled"
          :variant="open ? 'accent' : 'default'"
          show-chevron
          :chevron-active="open"
          aria-haspopup="menu"
          :aria-expanded="open"
          :aria-controls="panelId"
          @click="toggle"
        >
          <template v-if="$slots.icon" #icon><slot name="icon" /></template>
        </PopoverMenuItem>
      </div>
    </PopoverAnchor>

    <PopoverPortal>
      <PopoverContent
        as-child
        side="right"
        align="start"
        :side-offset="10"
        :align-offset="-8"
        :avoid-collisions="true"
        :collision-padding="8"
        @open-auto-focus="skipAutoFocus"
        @close-auto-focus="skipAutoFocus"
        @pointer-down-outside="keepOpen"
        @focus-outside="keepOpen"
        @escape-key-down="handleEscape"
      >
        <div
          :id="panelId"
          ref="panel"
          class="popover-submenu__panel"
          :data-overlay-owner="overlayOwner"
          role="menu"
          tabindex="-1"
          :aria-label="ariaLabel || label"
          :aria-labelledby="undefined"
          @pointerleave="handlePanelPointerLeave"
          @keydown="handlePanelKeydown"
        >
          <slot :close="close" />
        </div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
