export interface AvatarAccentRgb {
  r: number;
  g: number;
  b: number;
}

export interface AvatarAccentPresentation {
  background: `#${string}`;
  foreground: `#${string}`;
  shadow: string;
}

export function deriveAvatarAccent(rgb: AvatarAccentRgb): AvatarAccentPresentation;
