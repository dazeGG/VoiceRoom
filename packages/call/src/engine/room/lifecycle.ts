import { callPageState } from '../core/call-page.store';
// Shared room-updated/room-deleted dispatcher. Lifecycle frames arrive over the
// app WebSocket (room.updated/room.deleted, handleServerMessage in room.ts), and
// may reach a client on more than one logical channel, so the reaction lives
// here once instead of being duplicated in each handler.
import { t } from '@voiceroom/ui-kit/i18n';
import type { RoomLifecycleSummary } from '../core/types';
import { getCallPorts } from '../ports';
import { state } from '../core/room-runtime.store';
import { showToast } from '../ui/toast';

let handledRoomDeletedId: string | null = null;

function refreshRoomHeadingSoon(): void {
  void import('./room').then((module) => module.refreshRoomHeading());
}

function showRoomNotFoundSoon(): void {
  void import('./room').then((module) => module.showRoomNotFound());
}

export function applyRoomUpdated(room: RoomLifecycleSummary): void {
  if (room.roomId !== state.roomId) return;
  state.roomName = room.name || '';
  state.roomAvatarUrl = room.avatarUrl || '';
  state.roomIsStatic = room.isStatic === true;
  if (callPageState().screen === 'room') {
    refreshRoomHeadingSoon();
  }
}

export function applyRoomNotFound(roomId: string): void {
  if (roomId !== state.roomId) return;
  if (callPageState().screen === 'not-found') return;
  showRoomNotFoundSoon();
}

export function applyRoomDeleted(roomId: string): void {
  if (roomId !== state.roomId) return;
  // The owner initiated delete — skip the broadcast they would receive over the
  // WebSocket before navigation completes.
  if (getCallPorts().host.isDeletingRoom()) return;
  // A lifecycle frame may be delivered more than once; handle it a single time.
  if (handledRoomDeletedId === roomId) return;
  if (callPageState().screen === 'not-found') return;
  handledRoomDeletedId = roomId;
  showToast(t('Комната удалена владельцем'));
  showRoomNotFoundSoon();
}
