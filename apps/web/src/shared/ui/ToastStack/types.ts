import type { ToastItem } from '@voice-room/ui/toast';
export type { ToastItem } from '@voice-room/ui/toast';

export interface ToastStackProps {
  /** Id for the stack's container, for hosts that need to find it. */
  id?: string;
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}
