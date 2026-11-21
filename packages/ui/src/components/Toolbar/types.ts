export interface ToolbarProps {
  label: string;
}

export interface ToolbarActionProps {
  label: string;
  shortcut?: string[] | undefined;
  disabled?: boolean;
  tooltipTarget?: HTMLElement | undefined;
}
