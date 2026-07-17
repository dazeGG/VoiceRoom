import visualIdentity from '@voice-room/shared/visual-identity';
import type { AvatarColorKey } from '@voice-room/shared/validation';

export type { AvatarColorKey };

export interface AvatarColorToken {
  key: AvatarColorKey;
  background: string;
  foreground: string;
  shadow: string;
}

export const AVATAR_COLORS: Record<AvatarColorKey, AvatarColorToken> = {
  blurple: { key: 'blurple', background: 'oklch(58% 0.26 278)', foreground: '#fff', shadow: '0 10px 24px rgba(88, 101, 242, 0.32)' },
  violet: { key: 'violet', background: 'oklch(55% 0.25 304)', foreground: '#fff', shadow: '0 10px 24px rgba(139, 92, 246, 0.3)' },
  orchid: { key: 'orchid', background: 'oklch(58% 0.24 326)', foreground: '#fff', shadow: '0 10px 24px rgba(192, 92, 210, 0.3)' },
  magenta: { key: 'magenta', background: 'oklch(56% 0.26 351)', foreground: '#fff', shadow: '0 10px 24px rgba(219, 39, 119, 0.28)' },
  rose: { key: 'rose', background: 'oklch(58% 0.24 16)', foreground: '#fff', shadow: '0 10px 24px rgba(225, 29, 72, 0.28)' },
  coral: { key: 'coral', background: 'oklch(61% 0.22 36)', foreground: '#fff', shadow: '0 10px 24px rgba(234, 88, 12, 0.26)' },
  rust: { key: 'rust', background: 'oklch(53% 0.20 42)', foreground: '#fff', shadow: '0 10px 24px rgba(154, 52, 18, 0.26)' },
  amber: { key: 'amber', background: 'oklch(63% 0.19 70)', foreground: '#fff', shadow: '0 10px 24px rgba(180, 83, 9, 0.24)' },
  olive: { key: 'olive', background: 'oklch(50% 0.16 112)', foreground: '#fff', shadow: '0 10px 24px rgba(77, 124, 15, 0.24)' },
  green: { key: 'green', background: 'oklch(52% 0.19 148)', foreground: '#fff', shadow: '0 10px 24px rgba(22, 163, 74, 0.24)' },
  teal: { key: 'teal', background: 'oklch(53% 0.18 182)', foreground: '#fff', shadow: '0 10px 24px rgba(13, 148, 136, 0.24)' },
  cyan: { key: 'cyan', background: 'oklch(55% 0.17 214)', foreground: '#fff', shadow: '0 10px 24px rgba(8, 145, 178, 0.24)' },
  sky: { key: 'sky', background: 'oklch(57% 0.18 242)', foreground: '#fff', shadow: '0 10px 24px rgba(2, 132, 199, 0.25)' },
  blue: { key: 'blue', background: 'oklch(54% 0.22 260)', foreground: '#fff', shadow: '0 10px 24px rgba(37, 99, 235, 0.28)' },
  indigo: { key: 'indigo', background: 'oklch(51% 0.23 284)', foreground: '#fff', shadow: '0 10px 24px rgba(79, 70, 229, 0.3)' },
  slate: { key: 'slate', background: 'oklch(44% 0.06 260)', foreground: '#fff', shadow: '0 10px 24px rgba(51, 65, 85, 0.28)' }
};

export function getAvatarColor(key: string | null | undefined): AvatarColorToken {
  const color = AVATAR_COLORS[(key || '') as AvatarColorKey] || AVATAR_COLORS.blurple;
  return { ...color, shadow: 'none' };
}

for (const key of visualIdentity.AVATAR_COLOR_KEYS) {
  if (!AVATAR_COLORS[key]) throw new Error(`Missing avatar color token: ${key}`);
}
