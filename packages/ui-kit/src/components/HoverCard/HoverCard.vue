<script setup lang="ts">
import {
  HoverCardContent,
  HoverCardPortal,
  HoverCardRoot,
  HoverCardTrigger,
  PopoverContent,
  PopoverPortal,
  PopoverRoot
} from 'reka-ui';
import { computed, shallowRef, useTemplateRef } from 'vue';
import { overlayPortalTarget } from '../overlay-portal-target';
import type { HoverCardProps } from './types';

defineOptions({ inheritAttrs: false });

const props = withDefaults(defineProps<HoverCardProps>(), { side: 'bottom', align: 'start' });
defineSlots<{ trigger?(): unknown; default(): unknown }>();
const emit = defineEmits<{ escape: [] }>();

const open = defineModel<boolean>('open', { default: false });
const pressedTrigger = shallowRef<HTMLElement>();
const trigger = useTemplateRef<InstanceType<typeof HoverCardTrigger>>('trigger');
let restoredFocus = false;
const reference = computed(() => props.anchor ?? pressedTrigger.value);
const portalTarget = computed(() => overlayPortalTarget(reference.value ?? trigger.value?.$el));
const interactive = computed(() => props.pinned || Boolean(pressedTrigger.value));
const previewOpen = computed(() => open.value && !interactive.value);

function changePreview(value: boolean): void {
  if (interactive.value) return;
  if (value && (restoredFocus || window.matchMedia?.('(pointer: coarse)').matches)) return;
  open.value = value;
}

function handleFocus(): void {
  changePreview(true);
}

function activate(event: MouseEvent): void {
  if (event.defaultPrevented || !(event.currentTarget instanceof HTMLElement)) return;
  if (pressedTrigger.value) {
    changeInteractive(false);
    return;
  }
  pressedTrigger.value = event.currentTarget;
  open.value = true;
}

function changeInteractive(value: boolean): void {
  open.value = value;
  if (!value) pressedTrigger.value = undefined;
}

function closeAutoFocus(event: Event): void {
  event.preventDefault();
}

function onEscape(): void {
  const trigger = pressedTrigger.value;
  emit('escape');
  // Reka dismisses the panel after this event. Restore focus only for Escape.
  if (trigger && document.activeElement !== trigger) {
    queueMicrotask(() => {
      restoredFocus = true;
      trigger.focus();
    });
  }
}

function keepTriggerClick(event: CustomEvent<{ originalEvent: PointerEvent }>): void {
  const target = event.detail.originalEvent.target;
  if (target instanceof Node && pressedTrigger.value?.contains(target)) event.preventDefault();
}
</script>

<template>
  <HoverCardRoot :open="previewOpen" :open-delay="400" @update:open="changePreview">
    <HoverCardTrigger
      v-if="$slots.trigger"
      ref="trigger"
      as-child
      aria-haspopup="dialog"
      :aria-expanded="open"
      @focus="handleFocus"
      @blur="restoredFocus = false"
      @pointerenter="restoredFocus = false"
      @click="activate"
    >
      <slot name="trigger" />
    </HoverCardTrigger>
    <HoverCardPortal v-if="!interactive" :to="portalTarget">
      <HoverCardContent
        v-bind="{ ...$attrs, ...(anchor ? { reference: anchor } : {}) }"
        class="ui-hovercard"
        :side="side"
        :align="align"
        :side-offset="4"
        :collision-padding="8"
        role="dialog"
        :aria-label="ariaLabel"
        @escape-key-down="onEscape"
      >
        <slot />
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
  <PopoverRoot v-if="interactive" :open="open" :modal="false" @update:open="changeInteractive">
    <PopoverPortal :to="portalTarget">
      <PopoverContent
        v-bind="{ ...$attrs, ...(reference ? { reference } : {}) }"
        class="ui-hovercard"
        :side="side"
        :align="align"
        :side-offset="4"
        :collision-padding="8"
        :aria-label="ariaLabel"
        as-child
        @close-auto-focus="closeAutoFocus"
        @escape-key-down="onEscape"
        @pointer-down-outside="keepTriggerClick"
      >
        <div :aria-labelledby="undefined"><slot /></div>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
