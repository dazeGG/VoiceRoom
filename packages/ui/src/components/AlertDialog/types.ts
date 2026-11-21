export interface AlertDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  busy?: boolean;
}
