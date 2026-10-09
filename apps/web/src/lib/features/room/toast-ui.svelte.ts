import type { ToastItem } from '$lib/shared/ui';

// The in-room toasts, shown by the same ToastStack as the lobby's: several can
// be up at once, each closing on its own timer.
export const toastUi = $state<{ items: ToastItem[] }>({ items: [] });

let counter = 0;

export function dismissToastUi(id: string): void {
  toastUi.items = toastUi.items.filter((item) => item.id !== id);
}

export function showToastUi(
  message: string,
  options: {
    action?: () => void | Promise<void>;
    actionLabel?: string;
    description?: string;
    duration?: number;
    variant?: 'info' | 'error';
  } = {}
): void {
  const { action = null, actionLabel = '', description, duration = 3200, variant = 'info' } = options;
  const id = `room-toast-${Date.now()}-${counter++}`;
  toastUi.items = [
    ...toastUi.items,
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
