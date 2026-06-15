import visualIdentity from '@voice-room/shared/visual-identity';
import type { AvatarColorKey, RoomColorKey, RoomIconKey, RoomPresetKey } from '@voice-room/shared/validation';

export type { AvatarColorKey, RoomColorKey, RoomIconKey, RoomPresetKey };

export interface AvatarColorToken {
  key: AvatarColorKey;
  background: string;
  foreground: string;
  shadow: string;
}

export const AVATAR_COLORS: Record<AvatarColorKey, AvatarColorToken> = {
  blurple: { key: 'blurple', background: 'oklch(54% 0.22 276)', foreground: '#fff', shadow: '0 10px 24px rgba(88, 101, 242, 0.32)' },
  violet: { key: 'violet', background: 'oklch(50% 0.21 302)', foreground: '#fff', shadow: '0 10px 24px rgba(139, 92, 246, 0.3)' },
  orchid: { key: 'orchid', background: 'oklch(54% 0.20 325)', foreground: '#fff', shadow: '0 10px 24px rgba(192, 92, 210, 0.3)' },
  magenta: { key: 'magenta', background: 'oklch(52% 0.22 350)', foreground: '#fff', shadow: '0 10px 24px rgba(219, 39, 119, 0.28)' },
  rose: { key: 'rose', background: 'oklch(54% 0.21 18)', foreground: '#fff', shadow: '0 10px 24px rgba(225, 29, 72, 0.28)' },
  coral: { key: 'coral', background: 'oklch(56% 0.19 38)', foreground: '#fff', shadow: '0 10px 24px rgba(234, 88, 12, 0.26)' },
  rust: { key: 'rust', background: 'oklch(48% 0.17 45)', foreground: '#fff', shadow: '0 10px 24px rgba(154, 52, 18, 0.26)' },
  amber: { key: 'amber', background: 'oklch(57% 0.16 72)', foreground: '#fff', shadow: '0 10px 24px rgba(180, 83, 9, 0.24)' },
  olive: { key: 'olive', background: 'oklch(45% 0.13 112)', foreground: '#fff', shadow: '0 10px 24px rgba(77, 124, 15, 0.24)' },
  green: { key: 'green', background: 'oklch(47% 0.16 148)', foreground: '#fff', shadow: '0 10px 24px rgba(22, 163, 74, 0.24)' },
  teal: { key: 'teal', background: 'oklch(48% 0.15 182)', foreground: '#fff', shadow: '0 10px 24px rgba(13, 148, 136, 0.24)' },
  cyan: { key: 'cyan', background: 'oklch(50% 0.15 215)', foreground: '#fff', shadow: '0 10px 24px rgba(8, 145, 178, 0.24)' },
  sky: { key: 'sky', background: 'oklch(52% 0.16 242)', foreground: '#fff', shadow: '0 10px 24px rgba(2, 132, 199, 0.25)' },
  blue: { key: 'blue', background: 'oklch(49% 0.19 260)', foreground: '#fff', shadow: '0 10px 24px rgba(37, 99, 235, 0.28)' },
  indigo: { key: 'indigo', background: 'oklch(47% 0.20 284)', foreground: '#fff', shadow: '0 10px 24px rgba(79, 70, 229, 0.3)' },
  slate: { key: 'slate', background: 'oklch(40% 0.05 260)', foreground: '#fff', shadow: '0 10px 24px rgba(51, 65, 85, 0.28)' }
};

export function getAvatarColor(key: string | null | undefined): AvatarColorToken {
  return AVATAR_COLORS[(key || '') as AvatarColorKey] || AVATAR_COLORS.blurple;
}

export interface RoomPresetToken {
  key: string;
  iconKey: RoomIconKey;
  emoji: string;
  colorKey: RoomColorKey;
  background: string;
  ring: string;
}


const ROOM_ICON_EMOJIS = Object.fromEntries(
  visualIdentity.ROOM_PRESETS.map((preset) => [preset.iconKey, preset.emoji])
) as Record<RoomIconKey, string>;

const ROOM_COLOR_TOKENS: Record<RoomColorKey, Pick<RoomPresetToken, 'background' | 'ring'>> = {
  blue: { background: 'linear-gradient(135deg, oklch(55% 0.20 260), oklch(42% 0.16 282))', ring: 'rgba(88, 101, 242, 0.34)' },
  slate: { background: 'linear-gradient(135deg, oklch(42% 0.05 260), oklch(31% 0.04 255))', ring: 'rgba(148, 163, 184, 0.25)' },
  violet: { background: 'linear-gradient(135deg, oklch(50% 0.21 302), oklch(36% 0.15 285))', ring: 'rgba(139, 92, 246, 0.32)' },
  amber: { background: 'linear-gradient(135deg, oklch(63% 0.18 75), oklch(49% 0.16 52))', ring: 'rgba(245, 158, 11, 0.28)' },
  indigo: { background: 'linear-gradient(135deg, oklch(50% 0.20 284), oklch(38% 0.17 266))', ring: 'rgba(99, 102, 241, 0.32)' },
  rose: { background: 'linear-gradient(135deg, oklch(55% 0.21 18), oklch(43% 0.17 350))', ring: 'rgba(244, 63, 94, 0.3)' },
  rust: { background: 'linear-gradient(135deg, oklch(52% 0.18 45), oklch(39% 0.14 35))', ring: 'rgba(194, 65, 12, 0.28)' },
  green: { background: 'linear-gradient(135deg, oklch(49% 0.15 148), oklch(36% 0.10 170))', ring: 'rgba(34, 197, 94, 0.26)' }
};

function isRoomIconKey(value: string | null | undefined): value is RoomIconKey {
  return Boolean(value && Object.hasOwn(ROOM_ICON_EMOJIS, value));
}

function isRoomColorKey(value: string | null | undefined): value is RoomColorKey {
  return Boolean(value && Object.hasOwn(ROOM_COLOR_TOKENS, value));
}

export const ROOM_PRESETS: RoomPresetToken[] = visualIdentity.ROOM_PRESETS.map((preset) => ({
  key: preset.key,
  iconKey: preset.iconKey,
  emoji: preset.emoji,
  colorKey: preset.colorKey,
  ...ROOM_COLOR_TOKENS[preset.colorKey]
}));

export const DEFAULT_ROOM_PRESET = ROOM_PRESETS[0];

for (const key of visualIdentity.AVATAR_COLOR_KEYS) {
  if (!AVATAR_COLORS[key]) throw new Error(`Missing avatar color token: ${key}`);
}
for (const preset of visualIdentity.ROOM_PRESETS) {
  if (!ROOM_COLOR_TOKENS[preset.colorKey]) throw new Error(`Missing room color token: ${preset.colorKey}`);
  if (!ROOM_ICON_EMOJIS[preset.iconKey]) throw new Error(`Missing room icon token: ${preset.iconKey}`);
}

export function getRoomPreset(input: { roomPresetKey?: string; roomIconKey?: string; roomColorKey?: string; emoji?: string } | string | null | undefined): RoomPresetToken {
  if (typeof input === 'string') return ROOM_PRESETS.find((preset) => preset.key === input) || DEFAULT_ROOM_PRESET;
  const value = input || {};
  const presetByKey = ROOM_PRESETS.find((item) => item.key === value.roomPresetKey);
  if (presetByKey) return presetByKey;

  const iconKey = isRoomIconKey(value.roomIconKey) ? value.roomIconKey : DEFAULT_ROOM_PRESET.iconKey;
  const colorKey = isRoomColorKey(value.roomColorKey) ? value.roomColorKey : DEFAULT_ROOM_PRESET.colorKey;
  const hasIconKey = isRoomIconKey(value.roomIconKey);
  const hasColorKey = isRoomColorKey(value.roomColorKey);
  const presetByKeys = ROOM_PRESETS.find((item) => item.iconKey === iconKey && item.colorKey === colorKey);
  if (presetByKeys) return presetByKeys;

  if (hasIconKey || hasColorKey) {
    return {
      key: '',
      iconKey,
      emoji: ROOM_ICON_EMOJIS[iconKey],
      colorKey,
      ...ROOM_COLOR_TOKENS[colorKey]
    };
  }

  return ROOM_PRESETS.find((item) => item.emoji === value.emoji) || DEFAULT_ROOM_PRESET;
}
