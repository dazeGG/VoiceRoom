export const ROOM_SWITCH_CONFIRM_STORAGE_KEY = 'voice-room:confirm-room-switch';

/** Whether entering voice elsewhere should ask first. On unless turned off. */
export function readRoomSwitchConfirmEnabled(): boolean {
  try {
    return localStorage.getItem(ROOM_SWITCH_CONFIRM_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeRoomSwitchConfirmEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.removeItem(ROOM_SWITCH_CONFIRM_STORAGE_KEY);
    else localStorage.setItem(ROOM_SWITCH_CONFIRM_STORAGE_KEY, 'false');
  } catch {
    // Storage can be unavailable (private mode); the question keeps being asked.
  }
}

export function shouldConfirmRoomSwitch({
  connectedRoomId,
  targetRoomId,
  confirmEnabled
}: {
  connectedRoomId: string | null | undefined;
  targetRoomId: string;
  confirmEnabled: boolean;
}): boolean {
  return Boolean(confirmEnabled && connectedRoomId && targetRoomId && connectedRoomId !== targetRoomId);
}

/**
 * "Don't ask again" only sticks when the user actually switched; cancelling
 * never silences future questions.
 */
export function applyRoomSwitchDecision({ proceed, dontAskAgain }: { proceed: boolean; dontAskAgain: boolean }): boolean {
  if (proceed && dontAskAgain) writeRoomSwitchConfirmEnabled(false);
  return proceed;
}
