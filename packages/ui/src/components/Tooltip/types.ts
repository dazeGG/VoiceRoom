export interface TooltipProps {
  text: string;
  portalTarget?: HTMLElement | undefined;
  shortcut?: string[] | undefined;
  side?: 'top' | 'right' | 'bottom' | 'left' | undefined;
}
