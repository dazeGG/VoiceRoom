// Who is entering a room: a room link checks the account directly (and saves
// the room to it), and otherwise asks a guest for a name.

import { t } from '@/shared/i18n';
import { addRoomByCode, fetchOwnedRooms } from '@/api/auth';
import { displayNameOf } from '@/shared/utils/display-name';
import { useSessionStore } from '@/features/auth/session.store';
import { createLogger, errorContext } from '@/shared/log';
import { useRoomSettingsStore } from '../../room-settings.store';
import { getRoomShell, isRoomEmbedded } from '../core/embed';
import { state } from '../core/room-runtime.store';
import { persistName, requestGuestNameForRoom } from '../ui/names';
import { showToast } from '../ui/toast';

const log = createLogger('room');

export type RoomEntryGateResult = 'authenticated' | 'anonymous' | 'failure';

async function autoSaveRoomForAuthenticatedUser(roomId: string, current: () => boolean): Promise<void> {
  // Only a permanent room can be kept; the room check has already said which this is.
  if (!current() || !roomId || !state.roomIsStatic) return;
  try {
    await addRoomByCode(roomId);
    if (current()) getRoomShell().roomsChanged(roomId);
  } catch (error) {
    // Auto-save is a convenience side effect: already-pruned rooms and
    // transient bookmark failures must never block or noisy-toast the room
    // entry flow.
    log.debug('room auto-save skipped', errorContext(error));
  }
}

// Settings/delete UI is owner-only; the lobby's room list is the only place
// "owner" is known client-side, so cross-check it here. Nothing in a join needs
// the answer, so the join does not wait a round trip for it.
async function resolveRoomOwnership(roomId: string, current: () => boolean): Promise<void> {
  try {
    if (!current()) return;
    const owned = await fetchOwnedRooms();
    if (!current()) return;
    useRoomSettingsStore().isOwner = owned.some((room) => room.roomId === roomId && room.relationship === 'owner');
  } catch (ownedError) {
    log.warn('failed to resolve room ownership', errorContext(ownedError));
  }
}

/** Who enters the room: the signed-in account, a named guest, or nobody (a failed check). */
export async function resolveRoomEntryName(): Promise<RoomEntryGateResult> {
  let current: () => boolean;
  // Room links intentionally verify the account directly instead of using the
  // home session loader: this route has no lobby session UI, and an auth-check
  // failure must stop entry instead of silently treating the user as anonymous.
  // Inside the lobby the session is already known and shown; the token request
  // checks it on the server either way.
  try {
    const session = useSessionStore();
    const roomId = state.roomId;
    const result =
      isRoomEmbedded() && session.user
        ? { applied: true as const, user: session.user, context: session.context() }
        : await session.verifySession();
    if (!result.applied || state.roomId !== roomId) return 'failure';
    current = () => session.isCurrent(result.context) && state.roomId === roomId;
    if (!current()) return 'failure';
    const user = result.user;
    if (user) {
      persistName(displayNameOf(user));
      void autoSaveRoomForAuthenticatedUser(roomId, current);
      void resolveRoomOwnership(roomId, current);
      return 'authenticated';
    }
  } catch (error) {
    log.error('failed to check room entry session', errorContext(error));
    showToast(t('Не удалось проверить аккаунт. Попробуйте обновить страницу.'));
    return 'failure';
  }

  try {
    await requestGuestNameForRoom();
    return current() ? 'anonymous' : 'failure';
  } catch (error) {
    log.warn('guest name request cancelled', errorContext(error));
    return 'failure';
  }
}
