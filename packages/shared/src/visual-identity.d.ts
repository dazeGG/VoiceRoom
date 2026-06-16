import type { AvatarColorKey, RoomColorKey, RoomIconKey, RoomPreset } from './validation';

declare const visualIdentity: {
  AVATAR_COLOR_KEYS: readonly AvatarColorKey[];
  ROOM_ICON_KEYS: readonly RoomIconKey[];
  ROOM_COLOR_KEYS: readonly RoomColorKey[];
  ROOM_PRESETS: readonly RoomPreset[];
};

export default visualIdentity;
