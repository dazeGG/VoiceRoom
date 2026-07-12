export interface ToastItem {
  id: string;
  message: string;
  variant?: 'default' | 'error';
  actions?: Array<{
    label: string;
    onClick: (toastId: string) => void;
  }>;
}

export interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}
