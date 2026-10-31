// The start screen's actions: create a room or open one by its code. Both
// navigate to the room's page, which then checks entry and joins.

import { createRoom } from '@/api/rooms';
import { markInAppRoomNavigation } from '@/platform/open-in-app';
import { createLogger, errorContext } from '@/shared/log';
import { useStartUiStore } from '../../start-ui.store';
import { extractRoomId } from '@/shared/utils/room';
import { errorMessage } from '../core/utils';
import { requireSavedName } from '../ui/names';
import { showToast } from '../ui/toast';

const log = createLogger('room');

export async function createRoomFromStart(): Promise<void> {
  const startUi = useStartUiStore();
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
  const startUi = useStartUiStore();
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
