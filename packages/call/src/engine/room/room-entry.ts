// Who is entering a room: a room link checks the account directly (and saves
// the room to it), and otherwise asks a guest for a name.

import { t } from '@voice-room/ui/i18n';
import { createLogger, errorContext } from '../diagnostics';
import { getRoomShell, isRoomEmbedded } from '../core/embed';
import { getCallPorts } from '../ports';
import { state } from '../core/room-runtime.store';
import { persistName, requestGuestNameForRoom } from '../ui/names';
import { showToast } from '../ui/toast';

const log = createLogger('room');

export type RoomEntryGateResult = 'authenticated' | 'anonymous' | 'failure';

/** Who enters the room: the signed-in account, a named guest, or nobody (a failed check). */
export async function resolveRoomEntryName(): Promise<RoomEntryGateResult> {
  let current: () => boolean;
  // Room links intentionally verify the account directly instead of using the
  // home session loader: this route has no lobby session UI, and an auth-check
  // failure must stop entry instead of silently treating the user as anonymous.
  // Inside the lobby the session is already known and shown; the token request
  // checks it on the server either way.
  try {
    const roomId = state.roomId;
    const { identity } = getCallPorts();
    // A known account enters without an await, so its effects stay synchronous.
    const entry = identity.knownEntry({ embedded: isRoomEmbedded() }) ?? (await identity.verifyEntry());
    if (state.roomId !== roomId) return 'failure';
    current = () => entry.isCurrent() && state.roomId === roomId;
    if (!current()) return 'failure';
    if (entry.identity.kind === 'account') {
      persistName(entry.identity.profile?.displayName || '');
      getCallPorts().host.entered({
        roomId,
        isStatic: state.roomIsStatic,
        isCurrent: current,
        roomsChanged: () => getRoomShell().roomsChanged(roomId)
      });
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
