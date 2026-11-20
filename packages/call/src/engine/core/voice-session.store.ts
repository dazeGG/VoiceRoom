import { defineStore } from 'pinia';
import { ref } from 'vue';
import { wait } from './utils';
import { playPeerCue } from '../media/cues';
import { getCallPorts, getInstalledCallPorts } from '../ports';

type LeaveHandler = () => void;
type ControlHandler = () => void;

export const useVoiceSessionStore = defineStore('voice-session', () => {
  const roomId = ref<string | null>(null);
  const muted = ref(false);
  const deafened = ref(false);
  // Server timestamps for call-duration surfaces: when I joined the call and
  // when the room's current call started (RoomSnapshot.voiceActiveSince).
  const joinedAt = ref<number | null>(null);
  const roomActiveSince = ref<number | null>(null);

  let activeLeaveHandler: LeaveHandler | null = null;
  let activeToggleMic: ControlHandler | null = null;
  let activeToggleDeafen: ControlHandler | null = null;

  function setConnectedVoiceRoom(connectedRoomId: string): void {
    roomId.value = connectedRoomId || null;
    getInstalledCallPorts()?.host.setCallActive(roomId.value !== null);
  }

  function setVoiceSessionTiming(next: { joinedAt?: number | null; roomActiveSince?: number | null }): void {
    if ('joinedAt' in next) joinedAt.value = next.joinedAt ?? null;
    if ('roomActiveSince' in next) roomActiveSince.value = next.roomActiveSince ?? null;
  }

  function clearConnectedVoiceRoom(clearedRoomId?: string): void {
    if (!clearedRoomId || roomId.value === clearedRoomId) {
      roomId.value = null;
      getInstalledCallPorts()?.host.setCallActive(false);
      muted.value = false;
      deafened.value = false;
      joinedAt.value = null;
      roomActiveSince.value = null;
    }
  }

  function setVoiceControlsState(next: { muted: boolean; deafened: boolean }): void {
    muted.value = Boolean(next.muted);
    deafened.value = Boolean(next.deafened);
  }

  function registerActiveVoiceLeave(handler: LeaveHandler): () => void {
    activeLeaveHandler = handler;
    return () => {
      if (activeLeaveHandler === handler) {
        activeLeaveHandler = null;
      }
    };
  }

  async function leaveActiveVoiceRoomWithCue(): Promise<void> {
    if (!activeLeaveHandler) return;
    playPeerCue('leave');
    await wait(180);
    activeLeaveHandler();
    getCallPorts().feedback.offer();
  }

  async function leaveConnectedRoomMembership(): Promise<boolean> {
    const connectedRoomId = roomId.value;
    if (!connectedRoomId) return false;
    const left = await getCallPorts().host.leaveMembership(connectedRoomId);
    if (activeLeaveHandler) {
      playPeerCue('leave');
      await wait(180);
      activeLeaveHandler();
    }
    return left;
  }

  function registerActiveVoiceControls(handlers: {
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

  function toggleActiveVoiceMic(): void {
    activeToggleMic?.();
  }

  function toggleActiveVoiceDeafen(): void {
    activeToggleDeafen?.();
  }

  return {
    roomId,
    muted,
    deafened,
    joinedAt,
    roomActiveSince,
    setConnectedVoiceRoom,
    setVoiceSessionTiming,
    clearConnectedVoiceRoom,
    setVoiceControlsState,
    registerActiveVoiceLeave,
    leaveActiveVoiceRoomWithCue,
    leaveConnectedRoomMembership,
    registerActiveVoiceControls,
    toggleActiveVoiceMic,
    toggleActiveVoiceDeafen
  };
});
