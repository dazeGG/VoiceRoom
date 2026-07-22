import type { Snippet } from 'svelte';

export interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  width?: number;
  initialFocus?: string;
  children?: Snippet;
}
