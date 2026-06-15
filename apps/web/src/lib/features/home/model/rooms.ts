import type { OwnedRoom } from '$lib/api/auth';

// Mirror of the API's room icon palette (packages/shared validation ROOM_EMOJIS).
// The create dialog offers exactly these; the server validates against the same set.
export const ROOM_EMOJIS = ['🎧', '📌', '🌙', '☀️', '🎮', '🎙️', '🔥'] as const;

export type RoomEmoji = (typeof ROOM_EMOJIS)[number];

// Warm tints for the icon tile, mirroring the design's per-room backgrounds.
const ROOM_TINTS = [
  'rgba(124,79,74,0.22)',
  'rgba(95,107,78,0.22)',
  'rgba(138,111,60,0.22)',
  'rgba(106,90,122,0.22)',
  'rgba(79,107,106,0.22)',
  'rgba(199,140,62,0.2)'
];

function hash(seed: string): number {
  let value = 0;
  for (let i = 0; i < seed.length; i += 1) {
    value = (value * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return value;
}

// Stable tint per room so the same room always gets the same icon background.
export function roomTint(seed: string): string {
  return ROOM_TINTS[hash(seed) % ROOM_TINTS.length];
}

export function roomDisplayName(room: OwnedRoom): string {
  return room.name?.trim() || room.roomId;
}

// Russian plural for «комната».
export function pluralizeRooms(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'комната';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'комнаты';
  return 'комнат';
}
