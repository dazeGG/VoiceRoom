import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ToastItem } from '@/shared/ui/ToastStack/types';

export type ToastOptions = Omit<ToastItem, 'id' | 'message'>;

// Queue of lobby/landing toasts, replacing the old single-message state so
// several notifications (e.g. a failed request right after a success one)
// can stack instead of clobbering each other. The in-room toast mechanism
// (the room client's own toast) is separate and untouched.
export const useToastsStore = defineStore('toasts', () => {
  const items = ref<ToastItem[]>([]);

  let counter = 0;

  function pushToast(message: string, options: ToastOptions = {}): string {
    const id = `toast-${Date.now()}-${counter++}`;
    const duration = options.duration ?? 3200;
    items.value = [...items.value, { ...options, id, message, duration }];
    if (duration > 0) window.setTimeout(() => dismissToast(id), duration);
    return id;
  }

  function dismissToast(id: string): void {
    items.value = items.value.filter((item) => item.id !== id);
  }

  return { items, pushToast, dismissToast };
});
