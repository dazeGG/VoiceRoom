export interface SplitterProps {
  sideClass?: string;
  direction?: 'horizontal' | 'vertical';
  singlePane?: 'side' | 'main' | undefined;
  label: string;
  size: number;
  minSize: number;
  maxSize: number;
  collapsedSize?: number;
  handleId?: string;
}

export interface SplitterSize {
  size: number;
  collapsed: boolean;
}
