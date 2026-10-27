<script setup lang="ts">
import { X } from '@lucide/vue';
import { DialogContent, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { iconSm } from '@/shared/ui/icons';
import { isToastPress } from './toast-press';
import type { DialogProps } from './types';

const props = withDefaults(defineProps<DialogProps>(), {
  width: 430,
  initialFocus: '[data-dialog-initial-focus]'
});

// Reka traps Tab, closes on Escape and on a press outside the card, and returns
// focus to the element that was focused before the dialog opened. Only the
// initial focus target is ours.
function onOpenAutoFocus(event: Event): void {
  const root = event.target;
  if (!(root instanceof HTMLElement)) return;
  const target = root.querySelector(props.initialFocus);
  if (!(target instanceof HTMLElement)) return;
  event.preventDefault();
  target.focus({ preventScroll: true });
}

function keepOnToastPress(event: Event): void {
  if (isToastPress(event)) event.preventDefault();
}

function onOpenChange(next: boolean): void {
  if (!next) props.onClose();
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <!-- Not DialogOverlay: it locks body scroll and the original had no lock. -->
      <div v-if="open" class="ui-dialog__overlay">
        <DialogContent
          class="ui-dialog__card"
          :style="{ width: `min(${width}px, 100%)` }"
          :aria-describedby="undefined"
          @open-auto-focus="onOpenAutoFocus"
          @pointer-down-outside="keepOnToastPress"
          @interact-outside="keepOnToastPress"
        >
          <div class="ui-dialog__head">
            <DialogTitle as="span" class="ui-dialog__title">{{ title }}</DialogTitle>
            <button
              class="ui-dialog__close"
              type="button"
              aria-label="Закрыть"
              data-dialog-initial-focus
              @click="onClose"
            >
              <X v-bind="iconSm" aria-hidden="true" />
            </button>
          </div>
          <div class="ui-dialog__body">
            <slot />
          </div>
        </DialogContent>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>
