import { getCallPorts } from '../ports';
// The start screen's actions: create a room or open one by its code. Both
// navigate to the room's page, which then checks entry and joins.

import { t } from '@voice-room/ui/i18n';
import { createLogger, errorContext } from '../diagnostics';
import { useStartUiStore } from '../core/start-ui.store';
import { extractRoomId } from '@voice-room/shared/app-home';
import { errorMessage } from '../core/utils';
import { requireSavedName } from '../ui/names';
import { showToast } from '../ui/toast';

const log = createLogger('room');

export async function createRoomFromStart(): Promise<void> {
  const startUi = useStartUiStore();
  if (!requireSavedName(startUi.nameInput)) return;

  startUi.createRoomLoading = true;
  try {
    openRoom(await getCallPorts().host.createRoom());
  } catch (error) {
    log.error('room action failed', errorContext(error));
    showToast(errorMessage(error) || t('Не удалось создать комнату'));
  } finally {
    startUi.createRoomLoading = false;
  }
}

export function joinRoomByCode(): void {
  const startUi = useStartUiStore();
  if (!requireSavedName(startUi.nameInput)) return;

  const roomId = extractRoomId(startUi.roomCode, window.location.origin);
  if (!roomId) {
    showToast(t('Введите код комнаты'));
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
  getCallPorts().platform.prepareRoomNavigation();
  getCallPorts().platform.navigateToRoom(roomId);
}
