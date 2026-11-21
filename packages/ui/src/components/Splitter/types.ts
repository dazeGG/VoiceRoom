export interface SplitterProps {
  label: string;
  width: number;
  minWidth: number;
  maxWidth: number;
  collapsedWidth?: number;
  handleId?: string;
}

export interface SplitterWidth {
  width: number;
  collapsed: boolean;
}
