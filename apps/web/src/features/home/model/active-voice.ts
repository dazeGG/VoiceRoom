// The call this device is in, as the sidebar's call card shows and drives it.

import { computed } from 'vue';
import { useVoiceSessionStore } from '@voiceroom/call/engine';
import { callPeer, useFriendCallStore } from '@/features/friend-call/friend-call.store';

export interface ActiveVoice {
  roomName: string;
  avatarUrl: string | null;
  friendCall?: {
    peerId: string;
    avatarColorKey: string | null;
    avatarAccent: string | null;
    status: 'ringing' | 'connected' | 'waiting' | 'connecting';
    since: number;
    controlsReady: boolean;
  };
  muted: boolean;
  deafened: boolean;
  open: () => void;
  toggleMic: () => void;
  toggleDeafen: () => void;
  leave: () => void;
}

export function useActiveFriendCall() {
  const calls = useFriendCallStore();
  const voice = useVoiceSessionStore();
  return computed<ActiveVoice | null>(() => {
    const seat = calls.voice;
    const record = seat && calls.record(seat.callId);
    if (!seat || !record) return null;
    const { call, offset } = record;
    if (call.phase === 'closed') return null;
    const peer = callPeer(call, calls.userId);
    const controlsReady = seat.roomId === voice.roomId;
    const status = {
      ringing: 'ringing',
      connected: 'connected',
      alone: 'waiting',
      connecting: 'connecting'
    } as const;

    return {
      roomName: peer.displayName,
      avatarUrl: peer.avatarUrl,
      friendCall: {
        peerId: peer.id,
        avatarColorKey: peer.avatarColorKey,
        avatarAccent: peer.avatarAccent,
        status: status[call.phase],
        since: ((call.phase === 'connected' ? call.firstConnectedAt : null) ?? call.startedAt) + offset,
        controlsReady
      },
      muted: !controlsReady || voice.muted,
      deafened: controlsReady && voice.deafened,
      open: calls.open,
      toggleMic: voice.toggleActiveVoiceMic,
      toggleDeafen: voice.toggleActiveVoiceDeafen,
      leave: () => void calls.leave()
    };
  });
}
