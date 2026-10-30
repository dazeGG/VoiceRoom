import { useToastUiStore } from '../../toast-ui.store';

export interface ToastOptions {
  action?: (() => void | Promise<void>) | undefined;
  actionLabel?: string | undefined;
  description?: string | undefined;
  duration?: number | undefined;
  variant?: 'info' | 'error' | undefined;
}

export function showToast(message: string, options: ToastOptions = {}): void {
  useToastUiStore().showToastUi(message, options);
}
