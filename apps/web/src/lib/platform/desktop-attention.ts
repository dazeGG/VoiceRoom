export interface DesktopBadgeInput {
  rooms: readonly { roomId: string; unreadCount?: number }[];
  roomUnreadById: Readonly<Record<string, number>>;
  friends: readonly { user: { id: string }; unreadCount: number }[];
  mutes: { mutedRoomIds: readonly string[]; mutedPeerIds: readonly string[] };
}

let lastSentCount: number | null = null;

function getBridge(): Window['voiceRoomDesktopAttention'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopAttention;
}

function positive(value: unknown): number {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

/**
 * Everything unread the lobby shows as a badge: room chats and direct
 * messages, minus the rooms and people whose notifications are muted.
 */
export function countUnreadForBadge(input: DesktopBadgeInput): number {
  const mutedRooms = new Set(input.mutes.mutedRoomIds);
  const mutedPeers = new Set(input.mutes.mutedPeerIds);
  let total = 0;
  for (const room of input.rooms) {
    if (mutedRooms.has(room.roomId)) continue;
    total += positive(input.roomUnreadById[room.roomId] ?? room.unreadCount);
  }
  for (const friend of input.friends) {
    if (mutedPeers.has(friend.user.id)) continue;
    total += positive(friend.unreadCount);
  }
  return total;
}

/** Mirrors the unread total onto the desktop app icon (taskbar dot, Dock count). */
export function syncDesktopBadgeCount(count: number): void {
  const bridge = getBridge();
  if (typeof bridge?.setBadgeCount !== 'function') return;
  const next = positive(count);
  if (next === lastSentCount) return;
  lastSentCount = next;
  void Promise.resolve()
    .then(() => bridge.setBadgeCount(next))
    .catch((error) => {
      if (lastSentCount === next) lastSentCount = null;
      console.warn('Desktop badge sync failed', error);
    });
}
