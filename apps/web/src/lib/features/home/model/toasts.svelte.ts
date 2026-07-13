import type { ToastItem } from '$lib/shared/ui';

// Queue of lobby/landing toasts, replacing the old single-message $state so
// several notifications (e.g. a failed request right after a success one)
// can stack instead of clobbering each other. The in-room toast mechanism
// (features/room/client/ui/toast.ts) is separate and untouched.
export const toastState = $state<{ items: ToastItem[] }>({ items: [] });

let counter = 0;

export type ToastOptions = Omit<ToastItem, 'id' | 'message'>;

export function pushToast(message: string, options: ToastOptions = {}): string {
  const id = `toast-${Date.now()}-${counter++}`;
  const duration = options.duration ?? 3200;
  toastState.items = [...toastState.items, { ...options, id, message, duration }];
  if (duration > 0) window.setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id: string): void {
  toastState.items = toastState.items.filter((item) => item.id !== id);
}
