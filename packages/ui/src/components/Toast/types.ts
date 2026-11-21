import type { ToastItem } from '../../toast';

export interface ToastProps {
  id?: string;
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
}
