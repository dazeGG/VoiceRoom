import type { Snippet } from 'svelte';

export type ContextMenuContentState = {
  close: (restoreFocus?: boolean) => void;
};

export type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  ariaLabel: string;
  restoreFocus?: HTMLElement | null;
  onClose: () => void;
  content: Snippet<[ContextMenuContentState]>;
};
