import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ToastItem } from '@voiceroom/ui-kit/toast';

// Web and Meet use a toast viewport, while the widget keeps its own notice timers.
export const useToastUiStore = defineStore('toast-ui', () => {
  const items = ref<ToastItem[]>([]);
  let counter = 0;
  let viewportManagesDuration = false;

  function useViewportTimers(enabled = true): void {
    viewportManagesDuration = enabled;
  }

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
    const { action = null, actionLabel = '', description, duration, variant = 'info' } = options;
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
    const timeout = duration ?? 3200;
    if (!viewportManagesDuration && timeout > 0) window.setTimeout(() => dismissToastUi(id), timeout);
  }

  return { items, dismissToastUi, showToastUi, useViewportTimers };
});
