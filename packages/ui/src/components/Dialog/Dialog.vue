<script setup lang="ts">
import { t } from '../../i18n';
import { X } from '@lucide/vue';
import { DialogContent, DialogDescription, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import IconButton from '../IconButton/IconButton.vue';
import { isToastPress } from './toast-press';
import type { DialogProps } from './types';

const props = withDefaults(defineProps<DialogProps>(), {
  size: 'md',
  trim: 'standard',
  closable: true,
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
  if (props.closeDisabled || isToastPress(event)) event.preventDefault();
}

function onOpenChange(next: boolean): void {
  if (!next && !props.closeDisabled) props.onClose?.();
}

function onEscape(event: KeyboardEvent): void {
  if (props.closeDisabled) event.preventDefault();
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <!-- Not DialogOverlay: it locks body scroll and the original had no lock. -->
      <div
        v-if="open"
        class="ui-overlay"
        :class="[layer && 'ui-overlay--' + layer, size === 'full' && 'ui-overlay--full']"
      >
        <DialogContent
          v-bind="description ? {} : { 'aria-describedby': undefined }"
          :class="[
            'ui-dialog',
            `ui-dialog--${size}`,
            { 'ui-dialog--bare': trim === 'bare', 'ui-dialog--overflow-visible': overflowVisible }
          ]"
          aria-modal="true"
          @open-auto-focus="onOpenAutoFocus"
          @pointer-down-outside="keepOnToastPress"
          @interact-outside="keepOnToastPress"
          @escape-key-down="onEscape"
        >
          <header class="ui-dialog__head" :class="{ 'ui-dialog__head--hidden': trim === 'bare' }">
            <div class="ui-dialog__titles">
              <DialogTitle as="h2" class="ui-dialog__title">{{ title }}</DialogTitle>
              <DialogDescription v-if="description" class="ui-dialog__desc">{{ description }}</DialogDescription>
            </div>
            <IconButton
              v-if="closable"
              class="ui-dialog__close"
              :label="t('Закрыть')"
              :size="32"
              :tooltip="false"
              :disabled="closeDisabled"
              data-dialog-initial-focus
              @click="onOpenChange(false)"
            >
              <X aria-hidden="true" />
            </IconButton>
          </header>
          <div class="ui-dialog__body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="ui-dialog__foot">
            <slot name="footer" />
          </footer>
        </DialogContent>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>
