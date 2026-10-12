import visualIdentity from '@voice-room/shared/visual-identity';
import type { AvatarColorKey } from '@voice-room/shared/validation';

export type { AvatarColorKey };

export interface AvatarColorToken {
  key: AvatarColorKey;
  hue: number;
  background: string;
  foreground: string;
  shadow: string;
}

// Each avatar colour is a hue; the pastel fill and its letter colour are
// derived from it, so every avatar sits at the same lightness on graphite.
const AVATAR_HUES: Record<AvatarColorKey, number> = {
  blurple: 278,
  violet: 304,
  orchid: 326,
  magenta: 351,
  rose: 16,
  coral: 36,
  rust: 42,
  amber: 70,
  olive: 112,
  green: 148,
  teal: 182,
  cyan: 214,
  sky: 242,
  blue: 260,
  indigo: 284,
  slate: 260
};

export function avatarBackground(hue: number): string {
  return `oklch(74% 0.1 ${hue})`;
}

export function avatarForeground(hue: number): string {
  return `oklch(25% 0.05 ${hue})`;
}

export function getAvatarColor(key: string | null | undefined): AvatarColorToken {
  const colorKey = (key && key in AVATAR_HUES ? key : 'blurple') as AvatarColorKey;
  const hue = AVATAR_HUES[colorKey];
  return {
    key: colorKey,
    hue,
    background: avatarBackground(hue),
    foreground: avatarForeground(hue),
    shadow: 'none'
  };
}

for (const key of visualIdentity.AVATAR_COLOR_KEYS) {
  if (!(key in AVATAR_HUES)) throw new Error(`Missing avatar color token: ${key}`);
}
