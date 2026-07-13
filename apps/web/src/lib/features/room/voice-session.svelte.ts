import { wait } from './client/core/utils';
import { playPeerCue } from './client/media/cues';

type LeaveHandler = () => void;
type ControlHandler = () => void;

export const voiceSession = $state<{
  roomId: string | null;
  muted: boolean;
  deafened: boolean;
  // Server timestamps for the sidebar call widget: when I joined the call and
  // when the room's current call started (RoomSnapshot.voiceActiveSince).
  joinedAt: number | null;
  roomActiveSince: number | null;
}>({
  roomId: null,
  muted: false,
  deafened: false,
  joinedAt: null,
  roomActiveSince: null
});

let activeLeaveHandler: LeaveHandler | null = null;
let activeToggleMic: ControlHandler | null = null;
let activeToggleDeafen: ControlHandler | null = null;

export function setConnectedVoiceRoom(roomId: string): void {
  voiceSession.roomId = roomId || null;
}

export function setVoiceSessionTiming(next: { joinedAt?: number | null; roomActiveSince?: number | null }): void {
  if ('joinedAt' in next) voiceSession.joinedAt = next.joinedAt ?? null;
  if ('roomActiveSince' in next) voiceSession.roomActiveSince = next.roomActiveSince ?? null;
}

export function clearConnectedVoiceRoom(roomId?: string): void {
  if (!roomId || voiceSession.roomId === roomId) {
    voiceSession.roomId = null;
    voiceSession.muted = false;
    voiceSession.deafened = false;
    voiceSession.joinedAt = null;
    voiceSession.roomActiveSince = null;
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

export async function leaveActiveVoiceRoomWithCue(): Promise<void> {
  if (!activeLeaveHandler) return;
  playPeerCue('leave');
  await wait(180);
  activeLeaveHandler();
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
