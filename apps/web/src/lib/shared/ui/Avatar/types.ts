export interface AvatarProps {
  name: string;
  src?: string | null;
  colorKey?: string | null;
  size?: number;
  shape?: 'circle' | 'squircle';
  background?: string | null;
  online?: boolean | null;
  showDot?: boolean;
  ring?: string;
  class?: string;
}
