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

export function deriveAvatarAccent(rgb: AvatarAccentRgb | null): AvatarAccentPresentation;

export function dominantAvatarColor(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): AvatarAccentRgb | null;
