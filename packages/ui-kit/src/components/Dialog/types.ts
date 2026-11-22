export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose?: () => void;
  description?: string;
  size?: DialogSize;
  layer?: 'raised' | 'nested' | 'security' | 'auth';
  layout?: 'standard' | 'media' | 'panel';
  modal?: boolean;
  /** `flush`: an evenly padded header over a divider and a body without padding, for a NavList running edge to edge. */
  trim?: 'standard' | 'flush' | 'bare';
  overflowVisible?: boolean;
  closable?: boolean;
  closeLabel?: string;
  closeDisabled?: boolean;
  initialFocus?: string;
}
