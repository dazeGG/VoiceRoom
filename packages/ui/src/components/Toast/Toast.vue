<script setup lang="ts">
import { Check, CircleAlert, Info, TriangleAlert, X } from '@lucide/vue';
import {
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastRoot,
  ToastTitle,
  ToastViewport
} from 'reka-ui';
import { computed } from 'vue';
import { t } from '../../i18n';
import type { ToastItem } from '../../toast';
import Button from '../Button/Button.vue';
import IconButton from '../IconButton/IconButton.vue';
import type { ToastProps } from './types';

const props = defineProps<ToastProps>();
const defaultDuration = 5000;
const visibleToasts = computed(() => props.toasts.slice(0, 3));
const icons = { success: Check, danger: CircleAlert, warning: TriangleAlert, info: Info };
const escapeRequests = new Set<string>();

function tone(variant: ToastItem['variant']) {
  if (variant === 'error') return 'danger';
  return variant === 'default' || !variant ? 'info' : variant;
}

// Reka listens for Escape on window for every toast. Ignore those requests
// without cancelling the shared event, so the active dialog can still close.
function ignoreGlobalEscape(id: string): void {
  escapeRequests.add(id);
  queueMicrotask(() => escapeRequests.delete(id));
}

function dismiss(id: string, open: boolean): void {
  if (!open && !escapeRequests.has(id)) props.onDismiss(id);
}

function dismissFocusedToast(event: KeyboardEvent, id: string): void {
  const target = event.currentTarget;
  if (target instanceof HTMLElement) target.closest<HTMLElement>('.ui-toaststack')?.focus();
  props.onDismiss(id);
}
</script>

<template>
  <ToastProvider :duration="defaultDuration" :label="t('Уведомления')" disable-swipe>
    <ToastRoot
      v-for="toast in visibleToasts"
      :id="toast.id"
      :key="toast.id"
      v-slot="{ remaining, duration }"
      :class="['ui-toast', `ui-toast--${tone(toast.variant)}`]"
      :duration="toast.duration ?? defaultDuration"
      type="background"
      open
      @update:open="dismiss(toast.id, $event)"
      @escape-key-down="ignoreGlobalEscape(toast.id)"
      @keydown.esc.stop="dismissFocusedToast($event, toast.id)"
    >
      <span class="ui-toast__icon" aria-hidden="true"><component :is="icons[tone(toast.variant)]" /></span>
      <div class="ui-toast__copy">
        <ToastTitle class="ui-toast__title"
          ><slot name="message" :message="toast.message">{{ toast.message }}</slot></ToastTitle
        >
        <ToastDescription v-if="toast.description" class="ui-toast__desc">{{ toast.description }}</ToastDescription>
      </div>
      <ToastAction v-if="toast.actions?.[0]" as-child :alt-text="toast.actions[0].label" :close-on-click="false">
        <Button class="ui-toast__action" variant="plain" size="sm" @click="toast.actions[0]?.onClick(toast.id)">
          {{ toast.actions[0].label }}
        </Button>
      </ToastAction>
      <ToastClose as-child>
        <IconButton class="ui-toast__close" :label="t('Закрыть уведомление')" :size="28" :tooltip="false">
          <X aria-hidden="true" />
        </IconButton>
      </ToastClose>
      <span
        v-if="duration > 0"
        class="ui-toast__progress"
        aria-hidden="true"
        :style="{ transform: `scaleX(${remaining / duration})` }"
      />
    </ToastRoot>
    <Teleport to="body">
      <ToastViewport
        :id="id"
        :class="['ui-toaststack', viewportClass]"
        role="list"
        :hotkey="['F8']"
        :label="(key) => `${t('Уведомления')} (${key})`"
      />
    </Teleport>
  </ToastProvider>
</template>
