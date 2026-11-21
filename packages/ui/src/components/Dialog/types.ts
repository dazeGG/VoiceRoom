export type DialogSize = 'sm' | 'md' | 'lg' | 'full';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose?: () => void;
  description?: string;
  size?: DialogSize;
  layer?: 'raised' | 'nested' | 'security' | 'auth';
  layout?: 'standard' | 'media' | 'panel';
  modal?: boolean;
  trim?: 'standard' | 'bare';
  overflowVisible?: boolean;
  closable?: boolean;
  closeLabel?: string;
  closeDisabled?: boolean;
  initialFocus?: string;
}
