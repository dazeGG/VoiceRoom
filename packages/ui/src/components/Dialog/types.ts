export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  description?: string;
  size?: DialogSize;
  closable?: boolean;
  closeDisabled?: boolean;
  initialFocus?: string;
}
