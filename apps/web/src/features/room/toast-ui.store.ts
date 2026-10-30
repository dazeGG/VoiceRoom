import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ToastItem } from '@/shared/ui/ToastStack/types';

// The in-room toasts, shown by the same ToastStack as the lobby's: several can
// be up at once, each closing on its own timer.
export const useToastUiStore = defineStore('toast-ui', () => {
  const items = ref<ToastItem[]>([]);
  let counter = 0;

  function dismissToastUi(id: string): void {
    items.value = items.value.filter((item) => item.id !== id);
  }

  function showToastUi(
    message: string,
    options: {
      action?: (() => void | Promise<void>) | undefined;
      actionLabel?: string | undefined;
      description?: string | undefined;
      duration?: number | undefined;
      variant?: 'info' | 'error' | undefined;
    } = {}
  ): void {
    const { action = null, actionLabel = '', description, duration = 3200, variant = 'info' } = options;
    const id = `room-toast-${Date.now()}-${counter++}`;
    items.value = [
      ...items.value,
      {
        id,
        message,
        description,
        duration,
        variant: variant === 'error' ? 'error' : 'default',
        // The stack keeps a toast open after its action, so the action closes it first.
        actions:
          action && actionLabel
            ? [
                {
                  label: actionLabel,
                  onClick: (toastId) => {
                    dismissToastUi(toastId);
                    void action();
                  }
                }
              ]
            : undefined
      }
    ];
    if (duration > 0) window.setTimeout(() => dismissToastUi(id), duration);
  }

  return { items, dismissToastUi, showToastUi };
});
