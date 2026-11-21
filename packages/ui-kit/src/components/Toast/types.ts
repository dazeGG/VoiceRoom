import type { ToastItem } from '@voiceroom/ui-kit/toast';

export interface ToastProps {
  viewportClass?: string;
  id?: string;
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
}
