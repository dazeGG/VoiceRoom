// Shared room-updated/room-deleted dispatcher. Both SSE consumers — the
// presence stream (`/api/events`, handleServerMessage in room.ts) and the
// chat stream (RoomChat.svelte) — carry these lifecycle frames, so the
// reaction lives here once instead of being duplicated in each handler.
import type { RoomLifecycleSummary } from '../core/types';
import { state } from '../core/state';
import { showToast } from '../ui/toast';
import { refreshRoomHeading, showRoomNotFound } from './room';

export function applyRoomUpdated(room: RoomLifecycleSummary): void {
  if (room.roomId !== state.roomId) return;
  state.roomName = room.name || '';
  state.roomEmoji = room.emoji || '';
  state.roomColorKey = room.roomColorKey || '';
  state.roomIconKey = room.roomIconKey || '';
  state.roomPresetKey = room.roomPresetKey || '';
  if (document.body.dataset.screen === 'room') {
    refreshRoomHeading();
  }
}

export function applyRoomDeleted(roomId: string): void {
  if (roomId !== state.roomId) return;
  showToast('Комната удалена владельцем');
  showRoomNotFound();
}
