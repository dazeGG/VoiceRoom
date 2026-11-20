export type ContextMenuContentState = {
  close: (restoreFocus?: boolean) => void;
};

/** The panel body is the default slot, scoped with `ContextMenuContentState`; `onClose` is the `close` event. */
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
};
