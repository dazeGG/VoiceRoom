<script setup lang="ts">
import { t } from '../../i18n';
import { X } from '@lucide/vue';
import { DialogContent, DialogDescription, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { useTemplateRef } from 'vue';
import IconButton from '../IconButton/IconButton.vue';
import { isToastPress } from './toast-press';
import type { DialogProps } from './types';
import { registerDialogOverlayTarget } from './dialog-overlay-target';

defineOptions({ inheritAttrs: false });
defineSlots<{
  default?(props: { close: () => void }): unknown;
  footer?(): unknown;
}>();

const props = withDefaults(defineProps<DialogProps>(), {
  size: 'md',
  layout: 'standard',
  modal: true,
  trim: 'standard',
  closable: true,
  initialFocus: '[data-dialog-initial-focus]'
});
const overlay = useTemplateRef<HTMLElement>('overlay');
registerDialogOverlayTarget(useTemplateRef<HTMLElement>('noticeTarget'));

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

function onInteractOutside(event: Event): void {
  if (!props.modal || props.closeDisabled || isToastPress(event)) event.preventDefault();
}

function onOpenChange(next: boolean): void {
  if (!next) close();
}

function close(): void {
  if (!props.closeDisabled) props.onClose?.();
}

function onEscape(event: KeyboardEvent): void {
  if (
    props.closeDisabled ||
    (!props.modal && (!(event.target instanceof Node) || !overlay.value?.contains(event.target)))
  ) {
    event.preventDefault();
  }
}

function onTab(event: KeyboardEvent): void {
  // Reka loops Tab in non-modal dialogs too. Let Tab leave an inline panel in document order.
  if (!props.modal) event.stopPropagation();
}
</script>

<template>
  <DialogRoot :open="open" :modal="modal" @update:open="onOpenChange">
    <DialogPortal :disabled="!modal">
      <!-- Not DialogOverlay: it locks body scroll and the original had no lock. -->
      <div
        v-if="open"
        ref="overlay"
        class="ui-overlay"
        :class="[
          layer && 'ui-overlay--' + layer,
          size === 'full' && 'ui-overlay--full',
          layout !== 'standard' && 'ui-overlay--' + layout,
          { 'ui-overlay--inline': !modal }
        ]"
        @keydown.tab.capture="onTab"
      >
        <DialogContent
          v-bind="{ ...(description ? {} : { 'aria-describedby': undefined }), ...$attrs }"
          :class="[
            'ui-dialog',
            `ui-dialog--${size}`,
            layout !== 'standard' && 'ui-dialog--' + layout,
            {
              'ui-dialog--bare': trim === 'bare',
              'ui-dialog--flush': trim === 'flush',
              'ui-dialog--overflow-visible': overflowVisible
            }
          ]"
          :aria-modal="modal || undefined"
          @open-auto-focus="onOpenAutoFocus"
          @pointer-down-outside="onInteractOutside"
          @interact-outside="onInteractOutside"
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
              :label="closeLabel ?? t('Закрыть')"
              :size="32"
              :tooltip="false"
              :disabled="closeDisabled"
              data-dialog-initial-focus
              @click="close"
            >
              <X aria-hidden="true" />
            </IconButton>
          </header>
          <div class="ui-dialog__body">
            <slot :close="close" />
          </div>
          <footer v-if="$slots.footer" class="ui-dialog__foot">
            <slot name="footer" />
          </footer>
          <div v-if="modal" ref="noticeTarget"></div>
        </DialogContent>
      </div>
    </DialogPortal>
  </DialogRoot>
</template>
