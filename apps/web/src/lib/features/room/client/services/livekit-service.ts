import type { LocalTrackPublication, Room } from 'livekit-client';
import { startUi } from '$lib/features/room/start-ui.svelte';
import { state } from '../core/state.svelte';
import { setVoiceConnectionStatus } from '../ui/status';
import { showToast } from '../ui/toast';
import { ApiError } from '$lib/api/client';
import { queueAudioUnlock, syncRemoteAudioPlayback } from './media-playback-service';
import { loadLiveKitClient } from '../media/livekit-runtime';
import { detachLiveKitParticipant, setParticipantSpeaking, updateParticipant } from '../room/participants';
import {
  isCurrentRoomRecoveryEpoch,
  notifyLiveKitDisconnected,
  notifyLiveKitReconciled,
  notifyLiveKitReconnecting,
  setRoomRecoveryLiveKitAdapter,
  type RecoveryAttemptOutcome
} from '../recovery/room-recovery';
import { LiveKitReconcileGeneration } from '../recovery/livekit-reconcile-generation';

import { isMicrophonePublication } from './livekit/publication-kinds';

// The LiveKit side of a call. Other room modules import from here; the files
// under ./livekit are its parts.
export {
  isMicrophonePublication,
  isScreenAudioPublication,
  isScreenPublication,
  isScreenVideoPublication
} from './livekit/publication-kinds';
export { isForcedRelayDiagnostic } from './livekit/transport';
export {
  findFirstLocalPublication,
  findLocalMicrophonePublication,
  publishLocalMicrophone,
  publishLocalScreenTracks,
  syncLocalMicrophonePublicationMuted,
  unpublishLocalMicrophone,
  unpublishLocalScreenTracks
} from './livekit/local-publications';
export {
  syncAuthoritativeScreenPresence,
  syncLiveKitParticipant,
  syncLiveKitParticipantById,
  syncLiveKitParticipants,
  syncLiveKitScreenSubscriptions,
  syncLiveKitVoiceSubscriptions,
  updateLiveKitPublicationState
} from './livekit/remote-participants';
import {
  LiveKitTransportError,
  connectLiveKitWithFallback,
  isRetryableLiveKitApiFailure,
  logLiveKitTransition,
  requestLiveKitCredentials,
  safeLiveKitCode
} from './livekit/transport';
import {
  disposeCandidatePublications,
  ensureLocalCameraPublished,
  ensureLocalMicrophonePublished,
  ensureLocalScreenPublished,
  publishLocalMicrophoneForRoom,
  publishLocalScreenTracksForRoom
} from './livekit/local-publications';
import {
  clearAllScreenSubscriptionRetries,
  createLiveKitParticipant,
  handleLiveKitTrackSubscribed,
  handleLiveKitTrackSubscriptionFailed,
  handleLiveKitTrackUnpublished,
  handleLiveKitTrackUnsubscribed,
  retryDemandedScreenSubscriptions,
  syncLiveKitParticipant,
  syncLiveKitParticipants,
  syncLiveKitPublicationSubscription,
  syncLiveKitVoiceSubscriptions,
  updateLiveKitPublicationState
} from './livekit/remote-participants';

const liveKitReconcileGenerations = new WeakMap<Room, LiveKitReconcileGeneration>();

function reconcileGenerationFor(room: Room): LiveKitReconcileGeneration {
  const existing = liveKitReconcileGenerations.get(room);
  if (existing) return existing;
  const generation = new LiveKitReconcileGeneration();
  liveKitReconcileGenerations.set(room, generation);
  return generation;
}

export async function connectLiveKitRoom(name: string, isCurrent: () => boolean = () => true): Promise<boolean> {
  setVoiceConnectionStatus('connecting');

  const credentials = await requestLiveKitCredentials(name, isCurrent);
  if (!isCurrent()) return false;

  const room = await connectLiveKitWithFallback(credentials, isCurrent);
  if (!room || !isCurrent()) return false;

  state.livekitRoom = room;
  const eventsBound = await bindLiveKitRoomEvents(room, isCurrent);
  if (!eventsBound || !isCurrent() || state.livekitRoom !== room) {
    await disconnectLiveKitRoomInstance(room);
    return false;
  }

  const stream = state.localStream;
  try {
    const published = await publishLocalMicrophoneForRoom(
      room,
      stream,
      () => isCurrent() && state.livekitRoom === room && state.localStream === stream
    );
    if (!published) {
      await disconnectLiveKitRoomInstance(room);
      return false;
    }
  } catch (error) {
    if (!isCurrent() || state.livekitRoom !== room) {
      await disconnectLiveKitRoomInstance(room);
      return false;
    }
    throw error;
  }

  if (!isCurrent() || state.livekitRoom !== room) {
    await disconnectLiveKitRoomInstance(room);
    return false;
  }
  // A camera turned on while the call was still connecting goes out now.
  void republishLocalCamera(room, () => isCurrent() && state.livekitRoom === room);
  syncLiveKitParticipants(room);
  setVoiceConnectionStatus('connected');
  return true;
}

export async function attemptFreshLiveKitReplacement({
  epoch
}: {
  epoch: number;
  attempt: number;
}): Promise<RecoveryAttemptOutcome> {
  const oldRoom = state.livekitRoom;
  const microphoneStream = state.localStream;
  const screenStream = state.localScreenStream;
  const roomId = state.roomId;
  const peerId = state.peerId;
  const sessionToken = state.sessionToken;
  const screenTrackIds =
    screenStream
      ?.getTracks()
      .map((track) => track.id)
      .sort()
      .join(':') ?? '';
  const identityCurrent = () =>
    isCurrentRoomRecoveryEpoch(epoch) &&
    state.joined &&
    state.roomId === roomId &&
    state.peerId === peerId &&
    state.sessionToken === sessionToken &&
    state.localStream === microphoneStream &&
    state.localScreenStream === screenStream &&
    (state.localScreenStream
      ?.getTracks()
      .map((track) => track.id)
      .sort()
      .join(':') ?? '') === screenTrackIds;
  const isCurrent = () => identityCurrent() && state.livekitRoom === oldRoom;
  let candidate: Room | null = null;
  let microphonePublication: LocalTrackPublication | null = null;
  let screenPublications = new Map<string, LocalTrackPublication>();

  try {
    if (oldRoom) reconcileGenerationFor(oldRoom).invalidate();
    const credentials = await requestLiveKitCredentials(state.self?.name || state.peerId, isCurrent);
    if (!isCurrent()) return { retryable: true, code: 'transport_error' };

    candidate = await connectLiveKitWithFallback(credentials, isCurrent);
    if (!candidate || !isCurrent()) return { retryable: true, code: 'transport_error' };
    const eventCurrent = () => identityCurrent() && (state.livekitRoom === oldRoom || state.livekitRoom === candidate);
    if (!(await bindLiveKitRoomEvents(candidate, eventCurrent)) || !isCurrent()) {
      await disconnectLiveKitRoomInstance(candidate);
      return { retryable: true, code: 'transport_error' };
    }

    microphonePublication = await publishLocalMicrophoneForRoom(candidate, microphoneStream, isCurrent, false);
    if (!microphonePublication || !isCurrent()) {
      await disconnectLiveKitRoomInstance(candidate);
      return { retryable: true, code: 'transport_error' };
    }
    screenPublications = await publishLocalScreenTracksForRoom(candidate, screenStream, isCurrent);
    if (!isCurrent()) {
      await disposeCandidatePublications(candidate, screenPublications);
      await disconnectLiveKitRoomInstance(candidate);
      return { retryable: true, code: 'transport_error' };
    }

    // Commit the fully reconciled candidate as one state transition. Until this
    // point its guarded event handlers cannot mutate shared room state.
    state.livekitRoom = candidate;
    state.localMicPublication = microphonePublication;
    state.localScreenPublications = screenPublications;
    state.localCameraPublication = null;
    clearAllScreenSubscriptionRetries();
    syncLiveKitParticipants(candidate);
    retryDemandedScreenSubscriptions(candidate);
    syncLiveKitVoiceSubscriptions();
    syncRemoteAudioPlayback();
    setVoiceConnectionStatus('connected');
    void republishLocalCamera(candidate, () => state.livekitRoom === candidate);

    if (oldRoom && oldRoom !== candidate) await disconnectLiveKitRoomInstance(oldRoom);
    logLiveKitTransition('info', { event: 'fresh_replacement', result: 'succeeded' });
    return { ok: true };
  } catch (error) {
    if (candidate && candidate !== state.livekitRoom) {
      await disposeCandidatePublications(candidate, screenPublications);
      await disconnectLiveKitRoomInstance(candidate);
    }
    const status = error instanceof ApiError ? error.status : 0;
    const code =
      error instanceof ApiError ? error.code : error instanceof LiveKitTransportError ? error.code : 'transport_error';
    logLiveKitTransition('warn', { event: 'fresh_replacement', result: 'failed', status, code: safeLiveKitCode(code) });
    return {
      retryable: !(error instanceof ApiError) || isRetryableLiveKitApiFailure(error),
      status,
      code
    };
  }
}

setRoomRecoveryLiveKitAdapter({ attemptFreshReplacement: attemptFreshLiveKitReplacement });

async function bindLiveKitRoomEvents(room: Room, isCurrent: () => boolean): Promise<boolean> {
  const { RoomEvent } = await loadLiveKitClient();
  if (!isCurrent()) return false;
  const current = () => isCurrent() && state.livekitRoom === room;
  const reconcileGeneration = reconcileGenerationFor(room);

  room.on(RoomEvent.Connected, () => {
    if (!current()) return;
    if (state.voiceConnection !== 'connected') setVoiceConnectionStatus('connecting');
  });
  room.on(RoomEvent.Reconnecting, () => {
    if (!current()) return;
    reconcileGeneration.invalidate();
    notifyLiveKitReconnecting();
    if (state.joined || state.connecting) setVoiceConnectionStatus('reconnecting');
  });
  room.on(RoomEvent.Reconnected, () => {
    if (!current()) return;
    const generation = reconcileGeneration.capture();
    if (state.joined || state.connecting) setVoiceConnectionStatus('connected');
    recoverLiveKitRoom(room, current)
      .then(() => {
        if (current() && reconcileGeneration.isCurrent(generation)) notifyLiveKitReconciled();
      })
      .catch(() => logLiveKitTransition('warn', { event: 'in_place_reconcile', result: 'failed' }));
  });
  room.on(RoomEvent.Disconnected, () => {
    if (!current()) return;
    reconcileGeneration.invalidate();
    if (state.joined) setVoiceConnectionStatus('lost');
    notifyLiveKitDisconnected();
  });
  room.on(RoomEvent.ParticipantConnected, (participant) => {
    if (!current()) return;
    syncLiveKitParticipant(participant);
  });
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (!current()) return;
    const peer = state.peers.get(participant.identity);
    if (peer) detachLiveKitParticipant(peer, 'голос переподключается');
  });
  room.on(RoomEvent.SignalReconnecting, () => {
    if (!current()) return;
    reconcileGeneration.invalidate();
    notifyLiveKitReconnecting();
    if (state.joined || state.connecting) setVoiceConnectionStatus('signal-reconnecting');
  });
  room.on(RoomEvent.SignalConnected, () => {
    if (!current()) return;
    if (state.voiceConnection === 'signal-reconnecting') setVoiceConnectionStatus('connecting');
  });
  room.on(RoomEvent.LocalTrackPublished, (publication) => {
    if (!current()) return;
    if (!isMicrophonePublication(publication)) return;
    state.localMicPublication = publication;
    setVoiceConnectionStatus('connected');
  });
  room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
    if (!current()) return;
    if (!isMicrophonePublication(publication)) return;
    state.localMicPublication = null;
    if (state.joined) setVoiceConnectionStatus('reconnecting');
  });
  room.on(RoomEvent.TrackSubscriptionFailed, (...args) => {
    if (!current()) return;
    handleLiveKitTrackSubscriptionFailed(...args);
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (!current()) return;
    if (room.canPlaybackAudio === false) {
      queueAudioUnlock({ showFallback: true });
      setVoiceConnectionStatus('playback-blocked');
    } else if (state.voiceConnection === 'playback-blocked') {
      state.audioUnlockPending = false;
      startUi.soundButtonVisible = false;
      setVoiceConnectionStatus('connected');
    }
  });
  room.on(RoomEvent.LocalAudioSilenceDetected, () => {
    if (!current()) return;
    if (!state.muted) showToast('Микрофон не передает звук');
  });
  room.on(RoomEvent.TrackPublished, (publication, participant) => {
    if (!current()) return;
    const peer = createLiveKitParticipant(participant);
    if (!peer) return;
    updateLiveKitPublicationState(peer, publication);
    syncLiveKitPublicationSubscription(peer, publication);
  });
  room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
    if (!current()) return;
    handleLiveKitTrackUnpublished(publication, participant);
  });
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (!current()) return;
    handleLiveKitTrackSubscribed(track, publication, participant);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    if (!current()) return;
    handleLiveKitTrackUnsubscribed(track, publication, participant);
  });
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    if (!current()) return;
    const activeIds = new Set(speakers.map((participant) => participant.identity));
    for (const peer of state.peers.values()) {
      // Fallback only — see the note in `updateSpeakingStats`.
      if (peer.analyser) continue;
      setParticipantSpeaking(peer, !state.outputMuted && activeIds.has(peer.id));
    }
  });
  room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
    if (!current()) return;
    if (!participant) return;
    if (participant.isLocal) {
      state.localConnectionQuality = quality || 'unknown';
      return;
    }
    const peer = createLiveKitParticipant(participant);
    if (!peer) return;
    peer.connectionQuality = quality || 'unknown';
  });
  room.on(RoomEvent.ParticipantNameChanged, (name, participant) => {
    if (!current()) return;
    updateParticipant({ id: participant.identity, name: name || participant.identity });
  });
  return true;
}

export async function disconnectLiveKitRoom(): Promise<void> {
  const room = state.livekitRoom;
  if (!room) {
    state.localMicPublication = null;
    state.localScreenPublications.clear();
    return;
  }

  await disconnectLiveKitRoomInstance(room);
}

export async function disconnectLiveKitRoomInstance(room: Room): Promise<void> {
  reconcileGenerationFor(room).invalidate();
  if (state.livekitRoom === room) {
    clearAllScreenSubscriptionRetries();
    state.livekitRoom = null;
    state.localMicPublication = null;
    state.localCameraPublication = null;
    state.localScreenPublications.clear();
  }

  try {
    room.removeAllListeners?.();
    await room.disconnect(false);
  } catch {
    logLiveKitTransition('warn', { event: 'disconnect', result: 'failed' });
  }
}

// The camera is optional: failing to publish it never fails the call.
async function republishLocalCamera(room: Room, isCurrent: () => boolean): Promise<void> {
  try {
    await ensureLocalCameraPublished(room, isCurrent);
  } catch {
    logLiveKitTransition('warn', { event: 'camera_republish', result: 'failed' });
  }
}

async function recoverLiveKitRoom(
  room: Room,
  isCurrent: () => boolean = () => state.livekitRoom === room
): Promise<void> {
  // A reconnect is a new transport epoch. A screen SID that exhausted its
  // bounded retry budget on the previous connection must be eligible again;
  // otherwise a transient outage longer than the retry window can strand the
  // publication until the sender republishes it with a new SID.
  clearAllScreenSubscriptionRetries();
  if (!isCurrent()) return;
  syncLiveKitParticipants(room);
  retryDemandedScreenSubscriptions(room);
  await ensureLocalMicrophonePublished();
  if (!isCurrent()) return;
  await ensureLocalScreenPublished(room, isCurrent);
  if (!isCurrent()) return;
  await republishLocalCamera(room, isCurrent);
  if (!isCurrent()) return;
  syncLiveKitVoiceSubscriptions();
  syncRemoteAudioPlayback();
}
