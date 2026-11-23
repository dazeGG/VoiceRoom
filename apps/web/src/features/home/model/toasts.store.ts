import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ToastItem } from '@voiceroom/ui-kit/toast';

export type ToastOptions = Omit<ToastItem, 'id' | 'message'>;

// Lobby and landing notifications displayed by the app-wide toast viewport.
export const useToastsStore = defineStore('toasts', () => {
  const items = ref<ToastItem[]>([]);

  let counter = 0;

  function pushToast(message: string, options: ToastOptions = {}): string {
    const id = `toast-${Date.now()}-${counter++}`;
    items.value = [...items.value, { ...options, id, message }];
    return id;
  }

  function dismissToast(id: string): void {
    items.value = items.value.filter((item) => item.id !== id);
  }

  return { items, pushToast, dismissToast };
});
