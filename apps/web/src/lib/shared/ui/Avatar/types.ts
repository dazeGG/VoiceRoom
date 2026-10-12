export interface AvatarProps {
  name: string;
  src?: string | null;
  colorKey?: string | null;
  size?: number;
  shape?: 'circle' | 'squircle';
  background?: string | null;
  /** Letter colour to go with a custom `background`; the palette's otherwise. */
  foreground?: string | null;
  online?: boolean | null;
  showDot?: boolean;
  dnd?: boolean;
  afk?: boolean;
  ring?: string;
  class?: string;
}
