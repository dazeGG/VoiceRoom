type LeaveHandler = () => void;

export const voiceSession = $state<{
  roomId: string | null;
}>({
  roomId: null
});

let activeLeaveHandler: LeaveHandler | null = null;

export function setConnectedVoiceRoom(roomId: string): void {
  voiceSession.roomId = roomId || null;
}

export function clearConnectedVoiceRoom(roomId?: string): void {
  if (!roomId || voiceSession.roomId === roomId) {
    voiceSession.roomId = null;
  }
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
