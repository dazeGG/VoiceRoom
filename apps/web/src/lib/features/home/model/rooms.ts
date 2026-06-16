import type { OwnedRoom } from '$lib/api/auth';
import { ROOM_PRESETS, getRoomPreset } from '$lib/visual/tokens';

export { ROOM_PRESETS, getRoomPreset };

export function roomDisplayName(room: OwnedRoom): string {
  return room.name?.trim() || room.roomId;
}

export function roomVisual(room: Pick<OwnedRoom, 'emoji' | 'roomColorKey' | 'roomIconKey' | 'roomPresetKey'>) {
  return getRoomPreset(room);
}

// Russian plural for «комната».
export function pluralizeRooms(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'комната';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'комнаты';
  return 'комнат';
}
