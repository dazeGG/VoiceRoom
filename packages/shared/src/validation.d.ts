export type AvatarColorKey =
  | 'blurple'
  | 'violet'
  | 'orchid'
  | 'magenta'
  | 'rose'
  | 'coral'
  | 'rust'
  | 'amber'
  | 'olive'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'slate';

export type RoomIconKey = 'headphones' | 'pin' | 'moon' | 'sun' | 'gamepad' | 'mic' | 'fire' | 'coffee' | 'music' | 'book';
export type RoomColorKey = 'blue' | 'slate' | 'violet' | 'amber' | 'indigo' | 'rose' | 'rust' | 'green';
export type RoomPresetKey = 'voice-blue' | 'focus-slate' | 'night-violet' | 'day-amber' | 'game-indigo' | 'talk-rose' | 'fire-rust' | 'coffee-amber' | 'music-rose' | 'study-green';

export interface RoomPreset {
  key: RoomPresetKey;
  iconKey: RoomIconKey;
  emoji: string;
  colorKey: RoomColorKey;
}

export const AVATAR_COLOR_KEYS: readonly AvatarColorKey[];
export const ROOM_ICON_KEYS: readonly RoomIconKey[];
export const ROOM_COLOR_KEYS: readonly RoomColorKey[];
export const ROOM_PRESET_KEYS: readonly RoomPresetKey[];
export const ROOM_PRESETS: readonly RoomPreset[];
export const ROOM_EMOJIS: readonly string[];

export const PASSWORD_MIN_LENGTH: number;
export const PASSWORD_MAX_LENGTH: number;
export const SCREEN_PROFILE_IDS: ReadonlySet<string>;

export function cleanAvatarColorKey(value: unknown): AvatarColorKey | '';
export function cleanDisplayName(value: unknown): string;
export function cleanLiveKitUrl(value: unknown): string;
export function cleanName(value: unknown): string;
export function cleanRoomColorKey(value: unknown): RoomColorKey | '';
export function cleanRoomEmoji(value: unknown): string;
export function cleanRoomIconKey(value: unknown): RoomIconKey | '';
export function cleanRoomName(value: unknown): string;
export function cleanRoomPresetKey(value: unknown): RoomPresetKey | '';
export function cleanScreenProfileId(value: unknown): string;
export function cleanStreamId(value: unknown): string;
export function getRoomPreset(value: unknown): RoomPreset | null;
export function isValidPassword(value: unknown): boolean;
export function normalizeLogin(value: unknown): string;
export function normalizePeerId(value: unknown): string;
export function normalizeRoomId(value: unknown): string;
export function normalizeSessionToken(value: unknown): string;
