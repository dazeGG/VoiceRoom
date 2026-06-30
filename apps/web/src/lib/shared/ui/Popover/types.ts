import type { Snippet } from 'svelte';

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

export type PopoverProps = {
  open?: boolean;
  placement?: PopoverPlacement;
  role?: PopoverRole;
  ariaLabel?: string;
  rootClass?: string;
  panelClass?: string;
  /** Keep panel in the DOM when closed (for ids the vanilla client updates). */
  keepContentMounted?: boolean;
  /** Flip vertically on open when the preferred side would leave the viewport. */
  flip?: boolean;
  onBeforeClose?: (reason: PopoverCloseReason) => boolean | void;
  trigger: Snippet<[PopoverTriggerState]>;
  content: Snippet<[PopoverContentState]>;
};

export type PopoverMenuItemProps = {
  label: string;
  onclick?: (event: MouseEvent) => void;
  disabled?: boolean;
  variant?: 'default' | 'danger';
  showChevron?: boolean;
  icon?: Snippet;
  role?: 'menuitem' | 'option';
};

export type PopoverDividerProps = {
  tight?: boolean;
};

// --- internal (not re-exported from index.ts) ---

export type PlacementAxis = {
  vertical: 'top' | 'bottom';
  horizontal: 'start' | 'end';
};
