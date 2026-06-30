import { showToastUi } from '../../toast-ui.svelte';

export interface ToastOptions {
  duration?: number;
  variant?: 'info' | 'error';
}

export function showToast(message: string, options: ToastOptions = {}): void {
  showToastUi(message, options);
}