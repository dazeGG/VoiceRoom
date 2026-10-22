export interface AvatarProps {
  name: string;
  src?: string | null | undefined;
  colorKey?: string | null | undefined;
  size?: number | undefined;
  shape?: 'circle' | 'squircle' | undefined;
  background?: string | null | undefined;
  /** Letter colour to go with a custom `background`; the palette's otherwise. */
  foreground?: string | null | undefined;
  online?: boolean | null | undefined;
  showDot?: boolean | undefined;
  dnd?: boolean | undefined;
  afk?: boolean | undefined;
  ring?: string | undefined;
  class?: string | undefined;
}
