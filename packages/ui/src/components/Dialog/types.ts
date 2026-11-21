export type DialogSize = 'sm' | 'md' | 'lg' | 'full';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose?: () => void;
  description?: string;
  size?: DialogSize;
  layer?: 'raised' | 'nested' | 'security' | 'auth';
  trim?: 'standard' | 'bare';
  overflowVisible?: boolean;
  closable?: boolean;
  closeDisabled?: boolean;
  initialFocus?: string;
}

export interface NativeDialogProps {
  label?: string;
  open?: boolean;
  modal?: boolean;
}
