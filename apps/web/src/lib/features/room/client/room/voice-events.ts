// What the room does with the voice events of the room it joined: the roster
// snapshot, peers joining, leaving and changing, moderation, and the room
// itself changing or going away.

import { SvelteSet } from 'svelte/reactivity';
import { getAppRealtime, type RealtimeEvent } from '$lib/api/realtime';
import { setVoiceSessionTiming } from '../../voice-session.svelte';
import { state } from '../core/state.svelte';
import { isMicrophoneShownMuted } from '../core/microphone-mute';
import { clearPeerJoinCue, playPeerCue, playPeerJoinCue } from '../media/cues';
import { notifyRoomSnapshotApplied } from '../recovery/room-recovery';
import {
  syncAuthoritativeScreenPresence,
  syncLiveKitParticipantById,
  syncLiveKitParticipants
} from '../services/livekit-service';
import { setServerConnectionStatus, setVoiceConnectionStatus } from '../ui/status';
import { showToast } from '../ui/toast';
import { applyRoomDeleted, applyRoomUpdated } from './lifecycle';
import { createParticipant, removePeer, syncPeers, updateParticipant } from './participants';
import { postState } from './presence';

export function createVoiceEventHandler(room: {
  leaveRoom: () => void;
  showModeration: (reason: 'banned' | 'kicked') => void;
  showNotFound: () => void;
}): (event: RealtimeEvent) => Promise<void> {
  const { leaveRoom } = room;
  return async function handleVoiceRealtimeEvent(event: RealtimeEvent): Promise<void> {
    if (event.type === 'pong') {
      setServerConnectionStatus('connected');
      return;
    }

    if (event.type === 'room.snapshot') {
      const snapshot = event.payload;
      if (snapshot.roomId !== state.roomId) return;
      const peers = Array.isArray(snapshot.peers) ? snapshot.peers : [];
      const localPeer = peers.find((peer) => peer.id === state.peerId);
      const remotePeers = peers.filter((peer) => peer.id !== state.peerId);
      state.serverPeerIds = new SvelteSet(remotePeers.map((peer) => peer.id).filter(Boolean));
      state.serverPeerSyncReady = true;
      // Prefer the server clock for the call widget timers: my joinedAt from the
      // authoritative peer record, the shared call start from the room snapshot.
      setVoiceSessionTiming({
        joinedAt: localPeer?.joinedAt ?? state.self?.joinedAt ?? null,
        roomActiveSince: snapshot.voiceActiveSince ?? null
      });
      setServerConnectionStatus('connected');
      syncPeers([...state.serverPeerIds]);
      if (localPeer) {
        // Local controls and stream attendance are owned by this client; the snapshot
        // may carry a stale server copy (e.g. changed while reconnecting), so keep them.
        updateParticipant({
          ...localPeer,
          screenAuthoritative: true,
          deafened: state.outputMuted,
          isLocal: true,
          muted: isMicrophoneShownMuted(),
          viewedScreenPeerId: state.self?.viewedScreenPeerId ?? localPeer.viewedScreenPeerId
        });
      }
      for (const peer of remotePeers) {
        syncAuthoritativeScreenPresence(peer.id, Boolean(peer.screen));
        createParticipant({ ...peer, screenAuthoritative: true });
      }
      syncLiveKitParticipants(state.livekitRoom);
      notifyRoomSnapshotApplied({
        appEpoch: getAppRealtime().getConnectionEpoch(),
        active: snapshot.mode === 'active',
        hasLocalPeer: Boolean(localPeer)
      });
      if (state.joined) postState().catch(() => {});
      return;
    }

    if (event.type === 'error') {
      if (event.payload.code === 'room_banned') {
        room.showModeration('banned');
        return;
      }
      showToast(event.payload.message || 'Ошибка realtime-соединения');
      if (
        event.payload.code === 'invalid_session' ||
        event.payload.code === 'join_failed' ||
        event.payload.code === 'room_full'
      ) {
        leaveRoom();
        setVoiceConnectionStatus('error');
      }
      return;
    }

    if (event.type === 'room.not_found') {
      room.showNotFound();
      return;
    }

    if (event.type === 'room.kicked' || event.type === 'room.banned') {
      if (event.payload.roomId === state.roomId && (!event.payload.peerId || event.payload.peerId === state.peerId)) {
        room.showModeration(event.type === 'room.banned' ? 'banned' : 'kicked');
      }
      return;
    }

    if (event.type === 'room.peer.joined') {
      if (event.payload.peer?.id) state.serverPeerIds.add(event.payload.peer.id);
      createParticipant({ ...event.payload.peer, screenAuthoritative: true });
      syncLiveKitParticipantById(event.payload.peer?.id);
      playPeerJoinCue(event.payload.peer?.id);
      return;
    }

    if (event.type === 'room.peer.left') {
      const hadPeer = state.peers.has(event.payload.peerId);
      state.serverPeerIds.delete(event.payload.peerId);
      removePeer(event.payload.peerId);
      clearPeerJoinCue(event.payload.peerId);
      if (hadPeer) playPeerCue('leave');
      return;
    }

    if (event.type === 'room.peer.updated') {
      syncAuthoritativeScreenPresence(event.payload.peer.id, Boolean(event.payload.peer.screen));
      updateParticipant({ ...event.payload.peer, screenAuthoritative: Object.hasOwn(event.payload.peer, 'screen') });
      return;
    }

    if (event.type === 'room.full') {
      showToast(`Комната заполнена: максимум ${event.payload.maxRoomPeers}`);
      leaveRoom();
      return;
    }

    if (event.type === 'room.updated') {
      applyRoomUpdated(event.payload.room);
      return;
    }

    if (event.type === 'room.deleted') {
      applyRoomDeleted(event.payload.roomId);
      return;
    }
  };
}
