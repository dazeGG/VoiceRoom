import { showToastUi } from '../../toast-ui.svelte';

export interface ToastOptions {
  action?: (() => void | Promise<void>) | undefined;
  actionLabel?: string | undefined;
  description?: string | undefined;
  duration?: number | undefined;
  variant?: 'info' | 'error' | undefined;
}

export function showToast(message: string, options: ToastOptions = {}): void {
  showToastUi(message, options);
}
