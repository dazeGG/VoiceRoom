import type { ToastItem } from '../../toast';

export interface ToastProps {
  viewportClass?: string;
  id?: string;
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
}
