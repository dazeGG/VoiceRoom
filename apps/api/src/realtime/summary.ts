import { buildRoomRealtimeSummary } from '@voice-room/shared/realtime';
import type { AvatarColorResolver, RoomRealtimeSummary } from '@voice-room/shared/realtime';

function buildRoomRealtimeSummaryFromLobbyRoom(
  room: Parameters<typeof buildRoomRealtimeSummary>[0],
  peers: Parameters<typeof buildRoomRealtimeSummary>[1],
  resolveAvatarColorKey?: AvatarColorResolver
): RoomRealtimeSummary {
  return buildRoomRealtimeSummary(room, peers, resolveAvatarColorKey);
}

function createSummaryCoalescer({ delayMs, flush }: { delayMs: number; flush: (roomId: string) => void }) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  function schedule(roomId: string): void {
    if (pending.has(roomId)) return;
    const timer = setTimeout(() => {
      pending.delete(roomId);
      flush(roomId);
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
    pending.set(roomId, timer);
  }

  function cancel(roomId: string): void {
    const timer = pending.get(roomId);
    if (!timer) return;
    clearTimeout(timer);
    pending.delete(roomId);
  }

  function clear(): void {
    for (const timer of pending.values()) clearTimeout(timer);
    pending.clear();
  }

  return { schedule, cancel, clear };
}

export { buildRoomRealtimeSummaryFromLobbyRoom, createSummaryCoalescer };
