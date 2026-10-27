<script setup lang="ts">
import { PopoverAnchor, PopoverContent, PopoverPortal, PopoverRoot } from 'reka-ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
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
const panel = ref<HTMLElement | null>(null);

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
  if (root.value?.contains(target) || panel.value?.contains(target)) return true;
  return target instanceof Element && Boolean(target.closest(`[data-overlay-owner="${panelId}"]`));
}

// Reka reports every dismissal attempt, also from a force-mounted panel that is
// closed. A closed panel ignores them; for an open one the trigger, the panel and
// a submenu owned by this popover are inside, and `onBeforeClose` may veto the rest.
function onDismissAttempt(reason: PopoverCloseReason, event: Event, target: EventTarget | null): void {
  if (!open.value || isInsidePopover(target) || props.onBeforeClose?.(reason) === false) {
    event.preventDefault();
  }
}

// Escape is handled here, not by Reka: Reka gives it to the topmost layer only,
// which is not always this popover. A submenu it owns takes the key first.
function onWindowKeydown(event: KeyboardEvent): void {
  if (!open.value || event.key !== 'Escape') return;
  if (document.querySelector(`[data-overlay-owner="${panelId}"]`)) return;
  if (props.onBeforeClose?.('escape') === false) return;
  close(true);
}

onMounted(() => window.addEventListener('keydown', onWindowKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKeydown));

// Reka's auto focus only runs when the panel mounts, which a force-mounted
// panel does not do on open; focus is moved by the `open` watcher below.
function skipAutoFocus(event: Event): void {
  event.preventDefault();
}

watch(
  open,
  (isOpen) => {
    if (isOpen && props.role === 'menu') void nextTick(() => focusMenuItem(0));
  },
  { flush: 'post', immediate: true }
);

function menuItems(): HTMLElement[] {
  if (!panel.value || props.role !== 'menu') return [];
  return Array.from(panel.value.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter((item) => {
    if (item.hasAttribute('disabled')) return false;
    if (item.getAttribute('aria-disabled') === 'true') return false;
    return item.tabIndex >= 0;
  });
}

function focusMenuItem(index: number): void {
  if (!open.value) return;
  const items = menuItems();
  if (items.length === 0) {
    panel.value?.focus();
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
</script>

<template>
  <PopoverRoot v-model:open="open" :modal="false">
    <PopoverAnchor as-child>
      <div ref="root" :class="['popover', rootClass]" :data-overlay-id="panelId">
        <slot name="trigger" v-bind="triggerState" />

        <!-- A panel that is not floating stays next to its trigger in the DOM, so Tab
             from the trigger enters it and a dialog's focus trap still contains it. -->
        <PopoverPortal :disabled="!floating" :force-mount="keepContentMounted">
          <PopoverContent
            as-child
            :force-mount="keepContentMounted"
            :side="axis.vertical"
            :align="axis.horizontal"
            :side-offset="10"
            :avoid-collisions="flip"
            :collision-padding="8"
            @open-auto-focus="skipAutoFocus"
            @close-auto-focus="skipAutoFocus"
            @escape-key-down="(event: KeyboardEvent) => event.preventDefault()"
            @pointer-down-outside="
              (event: CustomEvent<{ originalEvent: PointerEvent }>) =>
                onDismissAttempt('outside', event, event.detail.originalEvent.target)
            "
            @focus-outside="
              (event: CustomEvent<{ originalEvent: FocusEvent }>) =>
                onDismissAttempt('focusout', event, event.detail.originalEvent.target)
            "
          >
            <!-- The panel is our own element so the role and ids are ours; Reka puts
                 role="dialog" and an empty aria-labelledby on its content. -->
            <div
              :id="panelId"
              ref="panel"
              :class="[
                'popover__panel',
                panelClass,
                { 'popover__panel--closed': closedAndKept, 'popover__panel--floating': floating }
              ]"
              :data-overlay-id="panelId"
              :role="role"
              :aria-label="ariaLabel || undefined"
              :aria-labelledby="undefined"
              :aria-hidden="closedAndKept ? true : undefined"
              :hidden="closedAndKept"
              tabindex="-1"
              @keydown="onPanelKeydown"
            >
              <slot name="content" v-bind="contentState" />
            </div>
          </PopoverContent>
        </PopoverPortal>
      </div>
    </PopoverAnchor>
  </PopoverRoot>
</template>
