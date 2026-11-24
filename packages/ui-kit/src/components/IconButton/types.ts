import type { TooltipProps } from '../Tooltip/types';

export interface IconButtonProps {
  pill?: boolean;
  scrim?: boolean;
  dot?: boolean;
  /** Keep a disclosure trigger neutral while its controlled region is open. */
  neutralExpanded?: boolean;
  href?: string;
  label: string;
  size?: 24 | 28 | 32 | 40 | 44 | undefined;
  variant?: 'default' | 'filled' | 'outline' | 'soft' | 'primary' | 'danger' | undefined;
  tooltip?: boolean | undefined;
  tooltipSide?: TooltipProps['side'];
  tooltipTarget?: HTMLElement | undefined;
  shortcut?: string[] | undefined;
  disabled?: boolean | undefined;
  type?: 'button' | 'submit' | undefined;
}
