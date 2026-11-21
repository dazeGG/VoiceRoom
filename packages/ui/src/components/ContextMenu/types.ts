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
  headerLabel?: string;
};
