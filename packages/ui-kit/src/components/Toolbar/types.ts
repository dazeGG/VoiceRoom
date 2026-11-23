export interface ToolbarProps {
  label: string;
  variant?: 'floating' | 'bare';
}

export interface ToolbarActionProps {
  label: string;
  shortcut?: string[] | undefined;
  disabled?: boolean;
  tooltipTarget?: HTMLElement | undefined;
}
