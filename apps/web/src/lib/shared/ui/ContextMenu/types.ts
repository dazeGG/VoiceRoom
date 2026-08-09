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
  /** Drop the panel's inner padding for content that draws to its own edges. */
  padded?: boolean;
  /** Panels holding a card rather than a list of actions should say so. */
  role?: 'menu' | 'listbox' | 'dialog';
  onClose: () => void;
  content: Snippet<[ContextMenuContentState]>;
};
