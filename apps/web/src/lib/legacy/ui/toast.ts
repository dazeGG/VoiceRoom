import { elements } from './dom';

let toastTimer: number | undefined;

export interface ToastOptions {
  duration?: number;
  variant?: 'info' | 'error';
}

export function showToast(message: string, options: ToastOptions = {}): void {
  const { duration = 2400, variant = 'info' } = options || {};
  elements.toast.textContent = message;
  elements.toast.dataset.variant = variant;
  elements.toast.dataset.visible = 'true';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    elements.toast.dataset.visible = 'false';
  }, duration);
}
