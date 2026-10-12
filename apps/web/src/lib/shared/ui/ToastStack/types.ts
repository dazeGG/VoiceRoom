export interface ToastItem {
  id: string;
  message: string;
  description?: string;
  duration?: number;
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
  actions?: Array<{
    label: string;
    onClick: (toastId: string) => void;
  }>;
}

export interface ToastStackProps {
  /** Id for the stack's container, for hosts that need to find it. */
  id?: string;
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}
