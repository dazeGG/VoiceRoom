export interface TooltipProps {
  text: string;
  description?: string | undefined;
  /** The trigger already includes the tooltip text and description in its accessible label. */
  descriptionInLabel?: boolean;
  portalTarget?: HTMLElement | undefined;
  shortcut?: string[] | undefined;
  side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
}
