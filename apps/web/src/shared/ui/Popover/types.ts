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

/**
 * `danger` is destructive (coral), `friendly` is a relationship-building action
 * (green), `accent` marks the item the menu is primarily about.
 */
export type PopoverMenuItemVariant = 'default' | 'accent' | 'friendly' | 'danger';

/** The icon is the `icon` slot; `click`, `pointerenter` and `focus` are emitted. */
export type PopoverMenuItemProps = {
  label: string;
  disabled?: boolean | undefined;
  variant?: PopoverMenuItemVariant | undefined;
  /** Renders as the current choice: tinted row plus a check mark. */
  selected?: boolean | undefined;
  showChevron?: boolean | undefined;
  /** Chevron turns accent-coloured while the submenu it opens is showing. */
  chevronActive?: boolean | undefined;
  /** Keyboard shortcut shown right-aligned, e.g. "E" or "⌫". */
  hint?: string | undefined;
  role?: 'menuitem' | 'option' | 'button' | undefined;
  ariaHaspopup?: 'menu' | undefined;
  ariaExpanded?: boolean | undefined;
  ariaControls?: string | undefined;
};

export type PopoverMenuLabelProps = {
  text: string;
};

export type PopoverDividerProps = {
  tight?: boolean;
};

/** The icon is the `icon` slot and the panel body is the default slot, scoped with `{ close }`. */
export type PopoverSubmenuProps = {
  label: string;
  ariaLabel?: string;
  disabled?: boolean;
};

// --- internal (not re-exported from index.ts) ---

export type PlacementAxis = {
  vertical: 'top' | 'bottom';
  horizontal: 'start' | 'end';
};
