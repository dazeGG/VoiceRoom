// The start screen's actions: create a room or open one by its code. Both
// navigate to the room's page, which then checks entry and joins.

import { createRoom } from '$lib/api/rooms';
import { markInAppRoomNavigation } from '$lib/platform/open-in-app';
import { createLogger, errorContext } from '$lib/shared/log';
import { startUi } from '../../start-ui.svelte';
import { extractRoomId } from '../core/session';
import { errorMessage } from '../core/utils';
import { requireSavedName } from '../ui/names';
import { showToast } from '../ui/toast';

const log = createLogger('room');

export async function createRoomFromStart(): Promise<void> {
  if (!requireSavedName(startUi.nameInput)) return;

  startUi.createRoomLoading = true;
  try {
    openRoom(await createRoom());
  } catch (error) {
    log.error('room action failed', errorContext(error));
    showToast(errorMessage(error) || 'Не удалось создать комнату');
  } finally {
    startUi.createRoomLoading = false;
  }
}

export function joinRoomByCode(): void {
  if (!requireSavedName(startUi.nameInput)) return;

  const roomId = extractRoomId(startUi.roomCode);
  if (!roomId) {
    showToast('Введите код комнаты');
    return;
  }

  openRoom(roomId);
}

export function handleRoomCodeKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  joinRoomByCode();
}

function openRoom(roomId: string): void {
  markInAppRoomNavigation();
  window.location.href = `/r/${encodeURIComponent(roomId)}`;
}
