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
