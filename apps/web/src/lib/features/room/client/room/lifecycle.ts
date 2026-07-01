// Shared room-updated/room-deleted dispatcher. Lifecycle frames arrive over the
// app WebSocket (room.updated/room.deleted, handleServerMessage in room.ts), and
// may reach a client on more than one logical channel, so the reaction lives
// here once instead of being duplicated in each handler.
import type { RoomLifecycleSummary } from '../core/types';
import { roomSettingsUi } from '../../room-settings.svelte';
import { state } from '../core/state.svelte';
import { showToast } from '../ui/toast';
import { refreshRoomHeading, showRoomNotFound } from './room';

let handledRoomDeletedId: string | null = null;

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

export function applyRoomNotFound(roomId: string): void {
  if (roomId !== state.roomId) return;
  if (document.body.dataset.screen === 'not-found') return;
  showRoomNotFound();
}

export function applyRoomDeleted(roomId: string): void {
  if (roomId !== state.roomId) return;
  // The owner initiated delete — skip the broadcast they would receive over the
  // WebSocket before navigation completes.
  if (roomSettingsUi.deleting) return;
  // A lifecycle frame may be delivered more than once; handle it a single time.
  if (handledRoomDeletedId === roomId) return;
  if (document.body.dataset.screen === 'not-found') return;
  handledRoomDeletedId = roomId;
  showToast('Комната удалена владельцем');
  showRoomNotFound();
}
