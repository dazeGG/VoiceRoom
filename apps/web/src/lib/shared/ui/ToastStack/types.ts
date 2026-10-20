export interface ToastItem {
  id: string;
  message: string;
  description?: string | undefined;
  duration?: number | undefined;
  variant?: 'default' | 'success' | 'error' | 'warning' | 'info' | undefined;
  actions?:
    | Array<{
        label: string;
        onClick: (toastId: string) => void;
      }>
    | undefined;
}

export interface ToastStackProps {
  /** Id for the stack's container, for hosts that need to find it. */
  id?: string;
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}
