<script setup lang="ts">
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui';
import { computed, nextTick, ref, useId } from 'vue';
import { parsePlacement } from './popover-placement';
import type { PopoverCloseReason, PopoverContentState, PopoverProps, PopoverTriggerState } from './types';

const props = withDefaults(defineProps<PopoverProps>(), {
  placement: 'bottom-end',
  role: 'menu',
  ariaLabel: '',
  rootClass: '',
  panelClass: '',
  keepContentMounted: false,
  flip: false,
  floating: false
});

defineSlots<{
  trigger(state: PopoverTriggerState): unknown;
  content(state: PopoverContentState): unknown;
}>();

const open = defineModel<boolean>('open', { default: false });

const panelId = `popover-panel-${useId()}`;
const root = ref<HTMLElement | null>(null);
const panel = ref<{ $el: HTMLElement } | null>(null);
let restoreFocusOnClose = false;

// Reka's content sets role="dialog" and aria-labelledby itself; the role is ours to choose.
function applyRole(): void {
  // `$el` is Reka's positioning wrapper; the panel is its only child.
  const element = panel.value?.$el.firstElementChild;
  if (!(element instanceof HTMLElement)) return;
  element.setAttribute('role', props.role);
  element.id = panelId;
  element.removeAttribute('aria-labelledby');
}

const axis = computed(() => parsePlacement(props.placement));

function toggle(): void {
  open.value = !open.value;
}

function focusTrigger(): void {
  const triggerEl = root.value?.firstElementChild;
  if (triggerEl instanceof HTMLElement) {
    queueMicrotask(() => triggerEl.focus());
  }
}

function close(restoreFocus = true): void {
  open.value = false;
  if (restoreFocus) focusTrigger();
}

function isInsidePopover(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) return false;
  if (root.value?.contains(target) || panel.value?.$el.contains(target)) return true;
  return target instanceof Element && Boolean(target.closest(`[data-overlay-owner="${panelId}"]`));
}

// Reka reports every dismissal attempt; the trigger, the panel and a submenu
// owned by this popover are inside, and `onBeforeClose` may veto the rest.
function onDismissAttempt(reason: PopoverCloseReason, event: Event, target: EventTarget | null): void {
  if (isInsidePopover(target) || props.onBeforeClose?.(reason) === false) {
    event.preventDefault();
    return;
  }
  restoreFocusOnClose = reason === 'escape';
}

function onOpenAutoFocus(event: Event): void {
  event.preventDefault();
  if (props.role !== 'menu') return;
  void nextTick(() => focusMenuItem(0));
}

function onCloseAutoFocus(event: Event): void {
  event.preventDefault();
  if (restoreFocusOnClose) focusTrigger();
  restoreFocusOnClose = false;
}

function menuItems(): HTMLElement[] {
  if (!panel.value || props.role !== 'menu') return [];
  return Array.from(panel.value.$el.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter((item) => {
    if (item.hasAttribute('disabled')) return false;
    if (item.getAttribute('aria-disabled') === 'true') return false;
    return item.tabIndex >= 0;
  });
}

function focusMenuItem(index: number): void {
  const items = menuItems();
  if (items.length === 0) {
    const element = panel.value?.$el.firstElementChild;
    if (element instanceof HTMLElement) element.focus();
    return;
  }
  items[(index + items.length) % items.length]?.focus();
}

function onPanelKeydown(event: KeyboardEvent): void {
  if (props.role !== 'menu') return;
  const items = menuItems();
  if (items.length === 0) return;
  const currentIndex = items.findIndex((item) => item === document.activeElement);
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    focusMenuItem(currentIndex < 0 ? 0 : currentIndex + 1);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    focusMenuItem(currentIndex < 0 ? items.length - 1 : currentIndex - 1);
  } else if (event.key === 'Home') {
    event.preventDefault();
    focusMenuItem(0);
  } else if (event.key === 'End') {
    event.preventDefault();
    focusMenuItem(items.length - 1);
  }
}

const triggerState = computed<PopoverTriggerState>(() => ({
  open: open.value,
  toggle,
  close,
  panelId
}));

const contentState = computed<PopoverContentState>(() => ({
  open: open.value,
  close
}));

const closedAndKept = computed(() => props.keepContentMounted && !open.value);
const panelAttrs = computed(() => ({
  ...(props.ariaLabel ? { 'aria-label': props.ariaLabel } : {}),
  ...(closedAndKept.value ? { 'aria-hidden': true } : {})
}));
</script>

<template>
  <PopoverRoot v-model:open="open" :modal="false">
    <PopoverAnchor as-child>
      <div ref="root" :class="['popover', rootClass]" :data-overlay-id="panelId">
        <slot name="trigger" v-bind="triggerState" />
      </div>
    </PopoverAnchor>

    <PopoverPortal :force-mount="keepContentMounted">
      <PopoverContent
        ref="panel"
        :class="['popover__panel', panelClass, { 'popover__panel--closed': closedAndKept }]"
        :data-overlay-id="panelId"
        :hidden="closedAndKept"
        v-bind="panelAttrs"
        :force-mount="keepContentMounted"
        :side="axis.vertical"
        :align="axis.horizontal"
        :side-offset="10"
        :avoid-collisions="flip"
        :collision-padding="8"
        @vue:mounted="applyRole"
        @vue:updated="applyRole"
        @open-auto-focus="onOpenAutoFocus"
        @close-auto-focus="onCloseAutoFocus"
        @escape-key-down="(event: KeyboardEvent) => onDismissAttempt('escape', event, null)"
        @pointer-down-outside="
          (event: CustomEvent<{ originalEvent: PointerEvent }>) =>
            onDismissAttempt('outside', event, event.detail.originalEvent.target)
        "
        @focus-outside="
          (event: CustomEvent<{ originalEvent: FocusEvent }>) =>
            onDismissAttempt('focusout', event, event.detail.originalEvent.target)
        "
        @keydown="onPanelKeydown"
      >
        <slot name="content" v-bind="contentState" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
