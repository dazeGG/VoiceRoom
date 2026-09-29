// Who is entering a room: a room link checks the account directly (and saves
// the room to it), and otherwise asks a guest for a name.

import { addRoomByCode, fetchMe, fetchOwnedRooms } from '$lib/api/auth';
import { roomNameFor } from '$lib/features/auth/account';
import { setUser } from '$lib/features/auth/session.svelte';
import { createLogger, errorContext } from '$lib/shared/log';
import { roomSettingsUi } from '../../room-settings.svelte';
import { state } from '../core/state.svelte';
import { persistName, requestGuestNameForRoom } from '../ui/names';
import { showToast } from '../ui/toast';

const log = createLogger('room');

export type RoomEntryGateResult = 'authenticated' | 'anonymous' | 'failure';

async function autoSaveRoomForAuthenticatedUser(roomId: string): Promise<void> {
  if (!roomId) return;
  try {
    await addRoomByCode(roomId);
    window.dispatchEvent(new CustomEvent('voice-room:rooms-changed', { detail: { roomId } }));
  } catch (error) {
    // Auto-save is a convenience side effect: temporary rooms, already-pruned
    // rooms, and transient bookmark failures must never block or noisy-toast
    // the room entry flow.
    log.debug('room auto-save skipped', errorContext(error));
  }
}

/** Who enters the room: the signed-in account, a named guest, or nobody (a failed check). */
export async function resolveRoomEntryName(): Promise<RoomEntryGateResult> {
  // Room links intentionally verify the account directly instead of using the
  // home session loader: this route has no lobby session UI, and an auth-check
  // failure must stop entry instead of silently treating the user as anonymous.
  try {
    const user = await fetchMe();
    if (user) {
      setUser(user);
      persistName(roomNameFor(user));
      void autoSaveRoomForAuthenticatedUser(state.roomId);
      // Settings/delete UI is owner-only; the lobby's room list is the only
      // place "owner" is known client-side, so cross-check it here.
      try {
        const owned = await fetchOwnedRooms();
        roomSettingsUi.isOwner = owned.some((room) => room.roomId === state.roomId && room.relationship === 'owner');
      } catch (ownedError) {
        log.warn('failed to resolve room ownership', errorContext(ownedError));
      }
      return 'authenticated';
    }
  } catch (error) {
    log.error('failed to check room entry session', errorContext(error));
    showToast('Не удалось проверить аккаунт. Попробуйте обновить страницу.');
    return 'failure';
  }

  try {
    await requestGuestNameForRoom();
    return 'anonymous';
  } catch (error) {
    log.warn('guest name request cancelled', errorContext(error));
    return 'failure';
  }
}
