export interface DesktopCallState {
  active: boolean;
  roomId: string;
  roomName: string;
  micMuted: boolean;
  outputMuted: boolean;
}

export type DesktopCallAction = 'toggle-mic' | 'toggle-output' | 'disconnect';

const CALL_ACTIONS: readonly DesktopCallAction[] = ['toggle-mic', 'toggle-output', 'disconnect'];

let lastSentKey = '';

function getBridge(): Window['voiceRoomDesktopCall'] | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.voiceRoomDesktopCall;
}

function toPayload(state: DesktopCallState): DesktopCallState | { active: false } {
  if (!state.active) return { active: false };
  return {
    active: true,
    micMuted: state.micMuted === true,
    outputMuted: state.outputMuted === true,
    roomId: state.roomId || '',
    roomName: state.roomName || ''
  };
}

/** Mirrors the voice call into the tray, taskbar and Dock of the desktop app. */
export function syncDesktopCallState(state: DesktopCallState): void {
  const bridge = getBridge();
  if (typeof bridge?.setState !== 'function') return;
  const payload = toPayload(state);
  const key = JSON.stringify(payload);
  if (key === lastSentKey) return;
  lastSentKey = key;
  void Promise.resolve()
    .then(() => bridge.setState(payload))
    .catch((error) => {
      if (lastSentKey === key) lastSentKey = '';
      console.warn('Desktop call state sync failed', error);
    });
}

export function bindDesktopCallActions(handlers: Record<DesktopCallAction, () => void>): () => void {
  const bridge = getBridge();
  if (typeof bridge?.onAction !== 'function') return () => {};
  const unsubscribe = bridge.onAction((payload) => {
    const action = (payload as { action?: unknown } | null)?.action;
    if (typeof action === 'string' && CALL_ACTIONS.includes(action as DesktopCallAction)) {
      handlers[action as DesktopCallAction]();
    }
  });
  return typeof unsubscribe === 'function' ? unsubscribe : () => {};
}
