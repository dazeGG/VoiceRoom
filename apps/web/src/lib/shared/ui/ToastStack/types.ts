export interface ToastItem {
  id: string;
  message: string;
  variant?: 'default' | 'error';
}

export interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}
