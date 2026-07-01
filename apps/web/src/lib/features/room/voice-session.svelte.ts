type LeaveHandler = () => void;
type ControlHandler = () => void;

export const voiceSession = $state<{
  roomId: string | null;
  muted: boolean;
  deafened: boolean;
}>({
  roomId: null,
  muted: false,
  deafened: false
});

let activeLeaveHandler: LeaveHandler | null = null;
let activeToggleMic: ControlHandler | null = null;
let activeToggleDeafen: ControlHandler | null = null;

export function setConnectedVoiceRoom(roomId: string): void {
  voiceSession.roomId = roomId || null;
}

export function clearConnectedVoiceRoom(roomId?: string): void {
  if (!roomId || voiceSession.roomId === roomId) {
    voiceSession.roomId = null;
    voiceSession.muted = false;
    voiceSession.deafened = false;
  }
}

export function setVoiceControlsState(next: { muted: boolean; deafened: boolean }): void {
  voiceSession.muted = Boolean(next.muted);
  voiceSession.deafened = Boolean(next.deafened);
}

export function registerActiveVoiceLeave(handler: LeaveHandler): () => void {
  activeLeaveHandler = handler;
  return () => {
    if (activeLeaveHandler === handler) {
      activeLeaveHandler = null;
    }
  };
}

export function leaveActiveVoiceRoom(): void {
  activeLeaveHandler?.();
}

export function registerActiveVoiceControls(handlers: {
  toggleMic: ControlHandler;
  toggleDeafen: ControlHandler;
}): () => void {
  activeToggleMic = handlers.toggleMic;
  activeToggleDeafen = handlers.toggleDeafen;
  return () => {
    if (activeToggleMic === handlers.toggleMic) activeToggleMic = null;
    if (activeToggleDeafen === handlers.toggleDeafen) activeToggleDeafen = null;
  };
}

export function toggleActiveVoiceMic(): void {
  activeToggleMic?.();
}

export function toggleActiveVoiceDeafen(): void {
  activeToggleDeafen?.();
}
