<script setup lang="ts">
import { Check, CircleAlert, Info, TriangleAlert, X } from '@lucide/vue';
import { computed } from 'vue';
import EmojiText from '@/shared/chat/EmojiText.vue';
import { iconXs } from '@/shared/ui/icons';
import type { ToastStackProps } from './types';

const props = defineProps<ToastStackProps>();
const visibleToasts = computed(() => props.toasts.slice(-3));
const queuedCount = computed(() => Math.max(0, props.toasts.length - visibleToasts.value.length));
</script>

<template>
  <div v-if="toasts.length > 0" :id="id" class="ui-toaststack" role="status" aria-live="polite">
    <span v-if="queuedCount > 0" class="ui-toaststack__queue">+{{ queuedCount }} в очереди</span>
    <div
      v-for="toast in visibleToasts"
      :key="toast.id"
      class="ui-toast"
      :class="toast.variant && toast.variant !== 'default' ? `ui-toast--${toast.variant}` : undefined"
      :style="{ '--toast-duration': `${toast.duration ?? 3200}ms` }"
    >
      <span v-if="toast.variant && toast.variant !== 'default'" class="ui-toast__icon" aria-hidden="true">
        <Check v-if="toast.variant === 'success'" v-bind="iconXs" />
        <CircleAlert v-else-if="toast.variant === 'error'" v-bind="iconXs" />
        <TriangleAlert v-else-if="toast.variant === 'warning'" v-bind="iconXs" />
        <Info v-else v-bind="iconXs" />
      </span>
      <span class="ui-toast__copy"
        ><strong class="ui-toast__message"><EmojiText :text="toast.message" /></strong
        ><span v-if="toast.description" class="ui-toast__description">{{ toast.description }}</span></span
      >
      <div v-if="toast.actions?.length" class="ui-toast__actions">
        <button
          v-for="(action, i) in toast.actions"
          :key="i"
          class="ui-toast__action"
          type="button"
          @click="action.onClick(toast.id)"
        >
          {{ action.label }}
        </button>
      </div>
      <button class="ui-toast__close" type="button" aria-label="Закрыть уведомление" @click="onDismiss(toast.id)">
        <X v-bind="iconXs" aria-hidden="true" />
      </button>
      <span v-if="(toast.duration ?? 3200) > 0" class="ui-toast__progress" aria-hidden="true"></span>
    </div>
  </div>
</template>
