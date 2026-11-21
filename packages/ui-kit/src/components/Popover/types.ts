// PlacementAxis and the placement helpers are internal — intentionally not re-exported.

// --- public ---

export type PopoverPlacement = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';

export type PopoverRole = 'menu' | 'listbox' | 'dialog';

export type PopoverCloseReason = 'outside' | 'escape' | 'focusout';

export type PopoverTriggerState = {
  open: boolean;
  toggle: () => void;
  close: (restoreFocus?: boolean) => void;
  panelId: string;
};

export type PopoverContentState = {
  open: boolean;
  close: (restoreFocus?: boolean) => void;
};

/** The `open` flag is the component's `v-model:open`; the trigger and content are the `trigger` and `content` slots. */
export type PopoverProps = {
  placement?: PopoverPlacement;
  title?: string;
  role?: PopoverRole;
  ariaLabel?: string;
  rootClass?: string;
  panelClass?: string;
  /** Keep panel in the DOM when closed (for ids the vanilla client updates). */
  keepContentMounted?: boolean;
  /** Flip vertically on open when the preferred side would leave the viewport. */
  flip?: boolean;
  /** Kept for callers; the panel is always portaled to the body by Reka. */
  floating?: boolean;
  onBeforeClose?: (reason: PopoverCloseReason) => boolean | void;
};

// --- internal (not re-exported from index.ts) ---

export type PlacementAxis = {
  vertical: 'top' | 'bottom';
  horizontal: 'start' | 'end';
};
