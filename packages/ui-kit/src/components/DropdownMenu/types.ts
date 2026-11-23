export interface DropdownMenuProps {
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  ariaLabel?: string;
  disabled?: boolean;
  inline?: boolean;
  /** Place initial focus on the current choice in a single-choice menu. */
  focusChecked?: boolean;
}

export interface DropdownMenuContentState {
  close: (restoreFocus?: boolean) => void;
}
