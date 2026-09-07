import type {
  LocalTrackPublication,
  Participant as LiveKitParticipant,
  Room,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Track,
  TrackPublication
} from 'livekit-client';
import { MICROPHONE_AUDIO_BITRATE, SCREEN_AUDIO_BITRATE } from '../core/config';
import { startUi } from '$lib/features/room/start-ui.svelte';
import { state } from '../core/state.svelte';
import { setVoiceConnectionStatus } from '../ui/status';
import { showToast } from '../ui/toast';
import { ApiRequestError, postJson } from '../net/api';
import {
  attachMusicTrack,
  detachMusicTrack,
  getMusicTrackId,
  queueAudioUnlock,
  syncRemoteAudioPlayback
} from './media-playback-service';
import { clearPeerJoinCue } from '../media/cues';
import { getScreenProfile, getScreenPublishVideoOptions } from '../media/profiles';
import { loadLiveKitClient, TRACK_SOURCE } from '../media/livekit-runtime';
import { getScreenReceiverDemand } from '../media/screen-receiver-demand';
import { getScreenPublicationPresence } from '../media/screen-publication-state';
import { createScreenSubscriptionRetryController } from '../media/screen-subscription-retry';
import {
  applyRemoteScreenCue,
  attachRemoteScreenStream,
  attachRemoteTrack,
  createParticipant,
  ensureRemoteAudioElement,
  detachLiveKitParticipant,
  detachRemoteAudioTrack,
  detachRemoteScreen,
  detachRemoteScreenAudioTrack,
  detachRemoteScreenVideoTrack,
  detachRemoteScreenVideoTracks,
  refreshParticipantState,
  removePeer,
  setParticipantSpeaking,
  updateParticipant,
  updatePeerStatus
} from '../room/participants';
import { refreshScreenAction, refreshScreenStage, refreshScreenTiles } from '../ui/screen-view';
import type { Participant } from '../core/types';
import {
  isCurrentRoomRecoveryEpoch,
  notifyLiveKitDisconnected,
  notifyLiveKitReconciled,
  notifyLiveKitReconnecting,
  setRoomRecoveryLiveKitAdapter,
  subscribeRoomRecoveryTransitions,
  type RecoveryAttemptOutcome
} from '../recovery/room-recovery';
import { ScreenRecoveryGraceController } from '../recovery/screen-recovery-grace.js';
import { LiveKitReconcileGeneration } from '../recovery/livekit-reconcile-generation.js';

const screenSubscriptionRetryController = createScreenSubscriptionRetryController();
const screenRecoveryGrace = new ScreenRecoveryGraceController();
const liveKitReconcileGenerations = new WeakMap<Room, LiveKitReconcileGeneration>();

function reconcileGenerationFor(room: Room): LiveKitReconcileGeneration {
  const existing = liveKitReconcileGenerations.get(room);
  if (existing) return existing;
  const generation = new LiveKitReconcileGeneration();
  liveKitReconcileGenerations.set(room, generation);
  return generation;
}

subscribeRoomRecoveryTransitions((event) => {
  const phase = String(event.phase || '');
  const epoch = Number(event.epoch || 0);
  if (phase === 'recovering' || phase === 'waiting-app-snapshot' || phase === 'waiting-livekit') {
    screenRecoveryGrace.beginGlobal(epoch);
  } else if (phase === 'healthy') {
    screenRecoveryGrace.endGlobal(false);
  } else if (phase === 'failed' || phase === 'cancelled') {
    screenRecoveryGrace.endGlobal(true);
  }
});

export async function connectLiveKitRoom(
  name: string,
  isCurrent: () => boolean = () => true
): Promise<boolean> {
  setVoiceConnectionStatus('connecting');

  const credentials = await postJson('/api/livekit-token', {
    name,
    peerId: state.peerId,
    roomId: state.roomId,
    sessionToken: state.sessionToken
  });
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
  const screenTrackIds = screenStream?.getTracks().map((track) => track.id).sort().join(':') ?? '';
  const identityCurrent = () => isCurrentRoomRecoveryEpoch(epoch)
    && state.joined
    && state.roomId === roomId
    && state.peerId === peerId
    && state.sessionToken === sessionToken
    && state.localStream === microphoneStream
    && state.localScreenStream === screenStream
    && (state.localScreenStream?.getTracks().map((track) => track.id).sort().join(':') ?? '') === screenTrackIds;
  const isCurrent = () => identityCurrent() && state.livekitRoom === oldRoom;
  let candidate: Room | null = null;
  let microphonePublication: LocalTrackPublication | null = null;
  let screenPublications = new Map<string, LocalTrackPublication>();

  try {
    if (oldRoom) reconcileGenerationFor(oldRoom).invalidate();
    const credentials = await postJson('/api/livekit-token', {
      name: state.self?.name || state.peerId,
      peerId: state.peerId,
      roomId: state.roomId,
      sessionToken: state.sessionToken
    });
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
    clearAllScreenSubscriptionRetries();
    clearAllMusicSubscriptionRetries();
    syncLiveKitParticipants(candidate);
    retryDemandedScreenSubscriptions(candidate);
    syncLiveKitVoiceSubscriptions();
    syncRemoteAudioPlayback();
    refreshParticipantState();
    setVoiceConnectionStatus('connected');

    if (oldRoom && oldRoom !== candidate) await disconnectLiveKitRoomInstance(oldRoom);
    logLiveKitTransition('info', { event: 'fresh_replacement', result: 'succeeded' });
    return { ok: true };
  } catch (error) {
    if (candidate && candidate !== state.livekitRoom) {
      await disposeCandidatePublications(candidate, screenPublications);
      await disconnectLiveKitRoomInstance(candidate);
    }
    const status = error instanceof ApiRequestError ? error.status : 0;
    const code = error instanceof ApiRequestError ? error.code : error instanceof LiveKitTransportError ? error.code : 'transport_error';
    logLiveKitTransition('warn', { event: 'fresh_replacement', result: 'failed', status, code: safeLiveKitCode(code) });
    return {
      retryable: !(error instanceof ApiRequestError) || isRetryableLiveKitApiFailure(error),
      status,
      code
    };
  }
}

function isRetryableLiveKitApiFailure(error: ApiRequestError): boolean {
  if (['authentication_required', 'invalid_join', 'invalid_session', 'room_banned', 'room_full', 'room_not_found'].includes(error.code)) return false;
  return [408, 425, 429].includes(error.status)
    || error.status >= 500
    || ['livekit_gate_credential_unavailable', 'livekit_gate_principal_unavailable', 'livekit_gate_unavailable', 'membership_persist_failed', 'membership_unavailable'].includes(error.code);
}

function safeLiveKitCode(code: string): string {
  return [
    'authentication_required', 'invalid_join', 'invalid_session', 'room_banned', 'room_full', 'room_not_found',
    'livekit_gate_credential_unavailable', 'livekit_gate_principal_unavailable', 'livekit_gate_unavailable',
    'membership_persist_failed', 'membership_unavailable', 'transport_error'
  ].includes(code) ? code : 'unknown_error';
}

setRoomRecoveryLiveKitAdapter({ attemptFreshReplacement: attemptFreshLiveKitReplacement });

async function connectLiveKitWithFallback(
  credentials: { url: string; urls?: string[]; token: string },
  isCurrent: () => boolean
): Promise<Room | null> {
  const { Room } = await loadLiveKitClient();
  if (!isCurrent()) return null;
  const configuredUrls = credentials.urls?.length ? credentials.urls : [credentials.url];
  const urls = [...new Set(configuredUrls.flatMap(getLiveKitConnectUrls))];
  for (let candidateIndex = 0; candidateIndex < urls.length; candidateIndex += 1) {
    const url = urls[candidateIndex];
    if (!isCurrent()) return null;
    const room = new Room({
      adaptiveStream: false,
      dynacast: true
    });

    try {
      await room.connect(url, credentials.token, {
        autoSubscribe: false
      });
      if (!isCurrent()) {
        await disconnectLiveKitRoomInstance(room);
        return null;
      }
      logLiveKitTransition('info', { event: 'candidate_connect', candidateIndex, candidateCount: urls.length, result: 'connected' });
      return room;
    } catch {
      logLiveKitTransition('warn', { event: 'candidate_connect', candidateIndex, candidateCount: urls.length, result: 'failed' });
      await room.disconnect(false).catch(() => {});
      if (!isCurrent()) return null;
    }
  }

  throw new LiveKitTransportError();
}

function getLiveKitConnectUrls(url: string): string[] {
  const urls = [url];
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'localhost') {
      parsed.hostname = '127.0.0.1';
      urls.push(parsed.toString());
    } else if (parsed.hostname === '127.0.0.1') {
      parsed.hostname = 'localhost';
      urls.push(parsed.toString());
    }
  } catch {
    // Keep the backend-provided URL as-is.
  }
  return [...new Set(urls)];
}

function logLiveKitTransition(level: 'info' | 'warn', event: Record<string, string | number>): void {
  if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return;
  console[level]('livekit_recovery_transition', event);
}

class LiveKitTransportError extends Error {
  code = 'transport_error';
  status = 0;

  constructor() {
    super('LiveKit transport unavailable');
    this.name = 'LiveKitTransportError';
  }
}

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
    recoverLiveKitRoom(room, current).then(() => {
      if (current() && reconcileGeneration.isCurrent(generation)) notifyLiveKitReconciled();
    }).catch(() => logLiveKitTransition('warn', { event: 'in_place_reconcile', result: 'failed' }));
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
    refreshParticipantState();
  });
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    if (!current()) return;
    if (isMusicBotIdentity(participant.identity)) {
      teardownMusicLane();
      return;
    }
    const peer = state.peers.get(participant.identity);
    if (peer) detachLiveKitParticipant(peer, 'голос переподключается');
    refreshParticipantState();
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
    // `createLiveKitParticipant` returns null for the bot, so without this
    // branch a track the bot publishes while this client is already connected
    // would be dropped here and never subscribed.
    if (isMusicBotIdentity(participant.identity)) {
      handleMusicPublication(participant.identity, publication);
      return;
    }
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
      setParticipantSpeaking(peer, activeIds.has(peer.id));
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

export function syncLiveKitParticipants(room: Room | null): void {
  prunePeersOutsideServerList();
  // Runs on every room snapshot, and is the pass that catches a music
  // publication which existed before this client connected.
  reconcileMusicPublication();
  if (!room) return;

  room.remoteParticipants.forEach((participant) => {
    syncLiveKitParticipant(participant);
  });
}

export function syncLiveKitParticipant(participant: RemoteParticipant | null | undefined): Participant | null {
  if (!participant) return null;
  if (isMusicBotIdentity(participant.identity)) {
    participant.trackPublications.forEach((publication) => {
      handleMusicPublication(participant.identity, publication);
    });
    return null;
  }
  if (!isServerKnownRemotePeer(participant.identity)) return null;

  const peer = createLiveKitParticipant(participant);
  if (!peer) return null;

  participant.trackPublications.forEach((publication) => {
    updateLiveKitPublicationState(peer, publication);
    syncLiveKitPublicationSubscription(peer, publication);
    if (publication.track && publication.isSubscribed) {
      handleLiveKitTrackSubscribed(publication.track, publication, participant);
    }
  });

  return peer;
}

function createLiveKitParticipant(participant: LiveKitParticipant): Participant | null {
  if (!isServerKnownRemotePeer(participant.identity)) return null;

  const screenPresence = getScreenPublicationPresence(
    participant.trackPublications.values(),
    isScreenVideoPublication,
    isScreenAudioPublication
  );

  // muted/deafened intentionally omitted: presence (`room.peer.updated`) is the
  // single source of truth for them. LiveKit's isMicrophoneEnabled reflects track
  // publication state, not user intent (local mute only disables the capture track).
  const peer = createParticipant({
    id: participant.identity,
    isLocal: participant.isLocal || participant.identity === state.peerId,
    joinedAt: participant.joinedAt ? participant.joinedAt.getTime() : Date.now(),
    name: participant.name || participant.identity,
    screen: participant.isScreenShareEnabled || screenPresence.active,
    screenAudio: screenPresence.hasAudio
  });
  peer.livekitParticipant = participant;
  peer.voiceIssue = '';
  updatePeerStatus(peer);
  return peer;
}

function isServerKnownRemotePeer(peerId: string): boolean {
  if (!peerId || peerId === state.peerId) return true;
  return !state.serverPeerSyncReady || state.serverPeerIds.has(peerId);
}

export function syncLiveKitParticipantById(peerId: string | undefined): Participant | null {
  if (!peerId || peerId === state.peerId || !state.livekitRoom?.remoteParticipants?.get) return null;
  return syncLiveKitParticipant(state.livekitRoom.remoteParticipants.get(peerId));
}

function prunePeersOutsideServerList(): void {
  if (!state.serverPeerSyncReady) return;

  for (const peerId of state.peers.keys()) {
    if (!state.serverPeerIds.has(peerId)) {
      removePeer(peerId);
      clearPeerJoinCue(peerId);
    }
  }
}

// --- Shared music lane ---------------------------------------------------
//
// The music bot is a LiveKit participant that the server never lists as a room
// peer. That is deliberate and load-bearing:
//
//   * `isServerKnownRemotePeer` is NOT a subscription filter, it is the peer
//     materialization filter inside `createLiveKitParticipant`, which writes
//     into `state.peers`. The participant list and the stage tiles render from
//     `state.peers`, so relaxing it would put the bot in the UI.
//   * `prunePeersOutsideServerList` is the first statement of
//     `syncLiveKitParticipants`, which runs on every room snapshot, so a bot
//     peer would be created and destroyed in a loop — dropping the audio and
//     rebuilding its gain node every time.
//
// So the bot never becomes a peer. Instead every entry point branches on its
// identity *before* it reaches any track-source predicate: the bot publishes on
// the ScreenShareAudio source (livekit-rtc has no "music" source), and without
// the early branch its track would land in the screen-share paths with tiles
// and the subscription retry controller attached.

// Bounded retry budget for the music publication, one entry per track SID.
// This is the same controller the screen lane uses — its name records its first
// caller, not a restriction; the mechanism (backoff, a per-SID attempt cap, a
// response window) is exactly what a subscription that can fail silently needs.
//
// A plain toggle inside `reconcileMusicPublication` would not do: reconcile runs
// on the bot's 2s position heartbeat, so it would resubscribe every two seconds
// for as long as the failure lasted. `schedule` is idempotent and capped, so the
// heartbeat can drive recovery without becoming a subscribe storm.
const musicSubscriptionRetryController = createScreenSubscriptionRetryController();

export function isMusicBotIdentity(identity: string | null | undefined): boolean {
  return Boolean(identity) && identity === state.musicBotIdentity;
}

/**
 * Points the lane at a bot identity (or `''` for none) and reconciles.
 *
 * The identity arrives over the app WebSocket and may land before or after
 * `connectLiveKitRoom`, so this is safe to call at any time and as often as the
 * server repeats itself.
 */
export function setMusicBotIdentity(identity: string | null | undefined): void {
  const next = identity || '';
  if (state.musicBotIdentity !== next) {
    // Only an identity *change* tears the lane down. A new track from the same
    // bot must not, or local mute would not survive a track change.
    if (state.musicBotIdentity) teardownMusicLane();
    state.musicBotIdentity = next;
  }
  reconcileMusicPublication();
}

function teardownMusicLane(): void {
  musicSubscriptionRetryController.clearAll();
  detachMusicTrack();
}

/**
 * A reconnect is a new transport epoch, so a SID that exhausted its retry budget
 * on the previous connection must be eligible again — the same reason the screen
 * lane clears its budget there. Without this a transient outage longer than the
 * retry window strands the music until the bot republishes with a new SID.
 */
function clearAllMusicSubscriptionRetries(): void {
  musicSubscriptionRetryController.clearAll();
}

/**
 * Idempotently subscribes to and attaches the bot's current publication.
 *
 * This exists because the client connects with `autoSubscribe: false`: a client
 * that joins after the bot started receives no `TrackPublished` event for a
 * publication that already existed, so without a reconcile pass a late joiner
 * would hear nothing and no error would be raised anywhere.
 */
export function reconcileMusicPublication(): void {
  const identity = state.musicBotIdentity;
  if (!identity) {
    teardownMusicLane();
    return;
  }

  const participant = state.livekitRoom?.remoteParticipants?.get?.(identity);
  if (!participant) {
    detachMusicTrack();
    return;
  }

  participant.trackPublications.forEach((publication) => {
    handleMusicPublication(identity, publication);
  });
}

/**
 * The single handler every music branch funnels into.
 *
 * Subscription is unconditional: the local listening preference is applied as
 * gain on the `'media'` bus by `syncMusicAudioPlayback`, never by unsubscribing.
 * An unsubscribe would cost seconds of latency on unmute and would not survive
 * a track change.
 */
function handleMusicPublication(
  identity: string,
  publication: TrackPublication | null | undefined,
  track: RemoteTrack | null | undefined = null
): void {
  if (!isMusicBotIdentity(identity) || !publication) return;

  const remotePublication = publication as RemoteTrackPublication;
  if (typeof remotePublication.setSubscribed === 'function' && remotePublication.isDesired !== true) {
    remotePublication.setSubscribed(true);
  }

  const musicTrack = track ?? (remotePublication.track as RemoteTrack | null | undefined) ?? null;
  const mediaTrack = musicTrack?.mediaStreamTrack;
  const attachable = remotePublication.isSubscribed !== false
    && Boolean(mediaTrack)
    && mediaTrack!.kind === 'audio'
    && mediaTrack!.readyState !== 'ended';

  if (!attachable) {
    // Desired but carrying no live track. Usually transient — the track arrives
    // moments later on TrackSubscribed, and the scheduled attempt sees it
    // attached and clears itself. When it is not transient this is the only
    // thing standing between the listener and permanent silence.
    scheduleMusicSubscriptionRetry(remotePublication);
    return;
  }

  musicSubscriptionRetryController.clear(remotePublication.trackSid);
  attachMusicTrack(mediaTrack!);
}

function scheduleMusicSubscriptionRetry(publication: RemoteTrackPublication): void {
  if (typeof publication.setSubscribed !== 'function') return;

  musicSubscriptionRetryController.schedule({
    isAttached: () => {
      const trackId = (publication.track as RemoteTrack | null | undefined)?.mediaStreamTrack?.id;
      return Boolean(trackId) && trackId === getMusicTrackId();
    },
    // The bot may have left, or republished under a new SID, while the attempt
    // was pending; either way this publication is no longer the lane's.
    isCurrent: () => currentMusicPublicationFor(publication.trackSid) === publication,
    isDemanded: () => Boolean(state.musicBotIdentity),
    key: publication.trackSid,
    retry: () => {
      publication.setSubscribed(false);
      publication.setSubscribed(true);
    }
  });
}

function currentMusicPublicationFor(trackSid: string): TrackPublication | undefined {
  const identity = state.musicBotIdentity;
  if (!identity) return undefined;
  return state.livekitRoom?.remoteParticipants?.get?.(identity)?.trackPublications.get(trackSid);
}

function handleMusicPublicationGone(
  identity: string,
  publication: TrackPublication | null | undefined,
  track: RemoteTrack | null | undefined = null
): void {
  if (!isMusicBotIdentity(identity)) return;
  if (publication) musicSubscriptionRetryController.clear(publication.trackSid);

  const trackId = (track ?? (publication?.track as RemoteTrack | null | undefined))?.mediaStreamTrack?.id;
  // Without a track id the publication is gone with nothing left to match, so
  // the whole lane goes; with one, only the lane holding that track.
  detachMusicTrack(trackId || '');
}

/**
 * A failed subscription is the silent failure mode for this lane: no error
 * surfaces anywhere, there is just no sound. It goes on the same bounded retry
 * budget as a publication that is desired but carrying no track, so the two
 * routes to silence recover the same way and neither can spin.
 */
function handleMusicSubscriptionFailed(participant: RemoteParticipant, trackSid: string): void {
  const publication = participant.trackPublications.get(trackSid) as RemoteTrackPublication | undefined;
  if (publication) scheduleMusicSubscriptionRetry(publication);
}


export async function publishLocalMicrophone(): Promise<void> {
  const room = state.livekitRoom;
  const stream = state.localStream;
  if (!room || !stream) return;
  await publishLocalMicrophoneForRoom(
    room,
    stream,
    () => state.livekitRoom === room && state.localStream === stream
  );
}

async function publishLocalMicrophoneForRoom(
  room: Room,
  stream: MediaStream | null,
  isCurrent: () => boolean,
  commit = true
): Promise<LocalTrackPublication | null> {
  if (!stream || !isCurrent()) return null;
  const [track] = stream.getAudioTracks();
  if (!track) throw new Error('Браузер не отдал аудио-трек');

  const publication = await room.localParticipant.publishTrack(track, {
    audioPreset: { maxBitrate: MICROPHONE_AUDIO_BITRATE },
    dtx: true,
    name: 'microphone',
    red: true,
    source: TRACK_SOURCE.Microphone as Track.Source
  });
  if (!isCurrent()) {
    await room.localParticipant.unpublishTrack(publication.track ?? track, false).catch(() => {});
    return null;
  }
  if (commit) state.localMicPublication = publication;
  await syncMicrophonePublicationMuted(publication);
  if (!isCurrent()) {
    await room.localParticipant.unpublishTrack(publication.track ?? track, false).catch(() => {});
    return null;
  }
  return publication;
}

export async function unpublishLocalMicrophone(stopOnUnpublish = false): Promise<void> {
  if (!state.livekitRoom || !state.localMicPublication?.track) {
    state.localMicPublication = null;
    return;
  }

  await state.livekitRoom.localParticipant.unpublishTrack(state.localMicPublication.track, stopOnUnpublish);
  state.localMicPublication = null;
}

export async function syncLocalMicrophonePublicationMuted(): Promise<void> {
  const publication = state.localMicPublication;
  if (!publication) return;

  await syncMicrophonePublicationMuted(publication);
}

async function syncMicrophonePublicationMuted(publication: LocalTrackPublication): Promise<void> {
  if (state.muted) {
    await publication.mute();
  } else {
    await publication.unmute();
  }
}

export async function publishLocalScreenTracks(): Promise<void> {
  const room = state.livekitRoom;
  const stream = state.localScreenStream;
  if (!room || !stream) return;
  const publications = await publishLocalScreenTracksForRoom(
    room,
    stream,
    () => state.livekitRoom === room && state.localScreenStream === stream
  );
  if (state.livekitRoom === room && state.localScreenStream === stream) state.localScreenPublications = publications;
}

async function publishLocalScreenTracksForRoom(
  room: Room,
  stream: MediaStream | null,
  isCurrent: () => boolean,
  existing: Map<string, LocalTrackPublication> = new Map()
): Promise<Map<string, LocalTrackPublication>> {
  const publications = new Map<string, LocalTrackPublication>(existing);
  const created = new Map<string, LocalTrackPublication>();
  if (!stream || !isCurrent()) return publications;
  const profile = getScreenProfile(state.localScreenProfileId);
  for (const track of stream.getTracks().filter((candidate) => candidate.readyState !== 'ended')) {
    if (publications.has(track.id)) continue;
    const videoOptions = track.kind === 'video' ? await getScreenPublishVideoOptions(profile) : null;
    if (!isCurrent()) break;
    const publication = await room.localParticipant.publishTrack(track, {
      audioPreset: track.kind === 'audio' ? { maxBitrate: SCREEN_AUDIO_BITRATE } : undefined,
      ...(track.kind === 'audio' ? { dtx: false } : {}),
      name: track.kind === 'video' ? 'screen' : 'screen-audio',
      ...(videoOptions ?? {}),
      source: track.kind === 'video' ? videoOptions!.source : TRACK_SOURCE.ScreenShareAudio as Track.Source,
      stream: stream.id
    });
    if (!isCurrent()) {
      await room.localParticipant.unpublishTrack(publication.track ?? track, false).catch(() => {});
      break;
    }
    publications.set(track.id, publication);
    created.set(track.id, publication);
  }
  if (!isCurrent()) await disposeCandidatePublications(room, created);
  return publications;
}

async function disposeCandidatePublications(
  room: Room,
  publications: Map<string, LocalTrackPublication>
): Promise<void> {
  await Promise.allSettled([...publications.values()].map((publication) => {
    const track = publication.track;
    return track ? room.localParticipant.unpublishTrack(track, false) : Promise.resolve();
  }));
  publications.clear();
}

export async function unpublishLocalScreenTracks(stopOnUnpublish = false): Promise<void> {
  const room = state.livekitRoom;
  if (!room || state.localScreenPublications.size === 0) {
    state.localScreenPublications.clear();
    return;
  }

  const publications = [...state.localScreenPublications.values()];
  state.localScreenPublications.clear();
  await Promise.allSettled(
    publications
      .map((publication) => publication.track)
      .filter((track): track is NonNullable<typeof track> => Boolean(track))
      .map((track) => room.localParticipant.unpublishTrack(track, stopOnUnpublish))
  );
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

async function disconnectLiveKitRoomInstance(room: Room): Promise<void> {
  reconcileGenerationFor(room).invalidate();
  if (state.livekitRoom === room) {
    clearAllScreenSubscriptionRetries();
    teardownMusicLane();
    state.livekitRoom = null;
    state.localMicPublication = null;
    state.localScreenPublications.clear();
  }

  try {
    room.removeAllListeners?.();
    await room.disconnect(false);
  } catch {
    logLiveKitTransition('warn', { event: 'disconnect', result: 'failed' });
  }
}

export function updateLiveKitPublicationState(peer: Participant, publication: TrackPublication): void {
  // Defensive: the bot is never materialized into `state.peers`, so it should
  // not be able to reach here at all. The branch stands before every source
  // predicate anyway, because its publication is ScreenShareAudio and would
  // otherwise raise a screen-share flag on whichever peer carried it in.
  if (isMusicBotIdentity(peer.id)) {
    handleMusicPublication(peer.id, publication);
    return;
  }
  if (isScreenVideoPublication(publication)) {
    if (peer.screenAuthoritative === false) return;
    screenRecoveryGrace.cancel(peer.id);
    const hadScreen = peer.screen;
    peer.screen = true;
    applyRemoteScreenCue(peer, hadScreen, true);
    updatePeerStatus(peer);
    refreshScreenAction(peer);
    if (!hadScreen) refreshScreenTiles();
  }
  if (isScreenAudioPublication(publication)) {
    if (peer.screenAuthoritative === false) return;
    screenRecoveryGrace.cancel(peer.id);
    peer.screenAudio = true;
    updatePeerStatus(peer);
  }
  if (isMicrophonePublication(publication)) {
    peer.muted = publication.isMuted;
    peer.voiceIssue = '';
    updatePeerStatus(peer);
  }
}

function syncLiveKitPublicationSubscription(peer: Participant, publication: TrackPublication): void {
  // Before the source predicates: the microphone branch below binds subscription
  // to `state.outputMuted`, and reusing that policy for music would turn a local
  // mute into an unsubscribe.
  if (isMusicBotIdentity(peer.id)) {
    handleMusicPublication(peer.id, publication);
    return;
  }

  const remotePublication = publication as RemoteTrackPublication;
  if (typeof remotePublication.setSubscribed !== 'function') return;

  if (isMicrophonePublication(publication)) {
    setRemotePublicationSubscribed(remotePublication, !state.outputMuted);
    return;
  }

  if (isScreenPublication(publication)) {
    const subscribed = shouldSubscribeToScreen(peer);
    if (!subscribed) clearScreenSubscriptionRetry(remotePublication);
    setRemotePublicationSubscribed(remotePublication, subscribed);
    if (subscribed && isScreenVideoPublication(publication)) {
      void applyRemoteScreenVideoDemand(peer, remotePublication);
    }
    if (subscribed) {
      const attached = attachSubscribedRemoteScreenTrack(peer, remotePublication);
      if (!attached && remotePublication.isSubscribed && remotePublication.track) {
        void scheduleScreenSubscriptionRetry(peer, remotePublication);
      }
    }
  }
}

function attachSubscribedRemoteScreenTrack(
  peer: Participant,
  publication: RemoteTrackPublication
): boolean {
  if (!isScreenPublication(publication) || publication.isSubscribed === false) return false;

  const track = publication.track as RemoteTrack | null | undefined;
  const mediaTrack = track?.mediaStreamTrack;
  if (!track || !mediaTrack || mediaTrack.readyState === 'ended') return false;

  attachRemoteScreenStream(peer, track.mediaStream || new MediaStream([mediaTrack]));
  return Boolean(
    peer.screenStream?.getTracks().some((candidate) => candidate === mediaTrack && candidate.readyState !== 'ended')
  );
}

function shouldSubscribeToScreen(peer: Participant): boolean {
  if (peer.screenAuthoritative === false) return false;
  return getRemoteScreenDemand(peer) !== 'hidden';
}

function getRemoteScreenDemand(peer: Participant): ReturnType<typeof getScreenReceiverDemand> {
  return getScreenReceiverDemand(peer.id, state.viewedScreenPeerId, state.screenSubscribedPeerIds);
}

async function applyRemoteScreenVideoDemand(
  peer: Participant,
  publication: RemoteTrackPublication
): Promise<void> {
  if (!isScreenVideoPublication(publication)) return;
  if (!shouldSubscribeToScreen(peer)) return;

  const { VideoQuality } = await loadLiveKitClient();
  if (!shouldSubscribeToScreen(peer) || publication.isDesired === false) return;
  if (peer.livekitParticipant?.trackPublications.get(publication.trackSid) !== publication) return;

  const quality = getRemoteScreenDemand(peer) === 'stage' ? VideoQuality.HIGH : VideoQuality.LOW;
  publication.setVideoQuality(quality);
}

function handleLiveKitTrackSubscriptionFailed(
  trackSid: string,
  participant?: RemoteParticipant,
  error?: number
): void {
  if (!participant) return;
  if (isMusicBotIdentity(participant.identity)) {
    handleMusicSubscriptionFailed(participant, trackSid);
    return;
  }
  const peer = state.peers.get(participant.identity) || syncLiveKitParticipant(participant);
  if (!peer) return;

  const publication = participant.trackPublications.get(trackSid);
  if (isScreenPublication(publication)) {
    void scheduleScreenSubscriptionRetry(peer, publication as RemoteTrackPublication, error);
    return;
  }
  if (!isMicrophonePublication(publication)) return;

  peer.voiceIssue = 'голос не подключен';
  updatePeerStatus(peer);
}

async function scheduleScreenSubscriptionRetry(
  peer: Participant,
  publication: RemoteTrackPublication,
  error?: number
): Promise<void> {
  const { SubscriptionError } = await loadLiveKitClient();
  if (error === SubscriptionError.SE_CODEC_UNSUPPORTED) {
    clearScreenSubscriptionRetry(publication);
    logLiveKitTransition('warn', { event: 'screen_subscription', result: 'codec_unsupported' });
    return;
  }
  if (!shouldSubscribeToScreen(peer)) {
    clearScreenSubscriptionRetry(publication);
    return;
  }

  screenSubscriptionRetryController.schedule({
    isAttached: () => attachSubscribedRemoteScreenTrack(peer, publication),
    isCurrent: () => peer.livekitParticipant?.trackPublications.get(publication.trackSid) === publication,
    isDemanded: () => shouldSubscribeToScreen(peer),
    key: publication.trackSid,
    retry: () => {
      publication.setSubscribed(false);
      publication.setSubscribed(true);
      if (isScreenVideoPublication(publication)) void applyRemoteScreenVideoDemand(peer, publication);
    }
  });
}

function clearScreenSubscriptionRetry(publication: TrackPublication): void {
  screenSubscriptionRetryController.clear(publication.trackSid);
}

function clearAllScreenSubscriptionRetries(): void {
  screenSubscriptionRetryController.clearAll();
}

export function syncLiveKitScreenSubscriptions(peer: Participant | null): void {
  const participant = peer?.livekitParticipant;
  if (!peer || !participant) return;

  participant.trackPublications.forEach((publication) => {
    if (isScreenPublication(publication)) {
      syncLiveKitPublicationSubscription(peer, publication);
    }
  });
}

export function syncLiveKitVoiceSubscriptions(): void {
  const room = state.livekitRoom;
  if (!room) return;

  room.remoteParticipants.forEach((participant) => {
    const peer = state.peers.get(participant.identity);
    if (!peer) return;

    participant.trackPublications.forEach((publication) => {
      if (!isMicrophonePublication(publication)) return;
      syncLiveKitPublicationSubscription(peer, publication);
      ensureRemoteMicrophonePlayback(peer, publication);
    });
  });
}

function setRemotePublicationSubscribed(publication: RemoteTrackPublication, subscribed: boolean): void {
  if (publication.isDesired === subscribed) return;
  publication.setSubscribed(subscribed);
}

async function recoverLiveKitRoom(room: Room, isCurrent: () => boolean = () => state.livekitRoom === room): Promise<void> {
  // A reconnect is a new transport epoch. A screen SID that exhausted its
  // bounded retry budget on the previous connection must be eligible again;
  // otherwise a transient outage longer than the retry window can strand the
  // publication until the sender republishes it with a new SID.
  clearAllScreenSubscriptionRetries();
  clearAllMusicSubscriptionRetries();
  if (!isCurrent()) return;
  syncLiveKitParticipants(room);
  retryDemandedScreenSubscriptions(room);
  await ensureLocalMicrophonePublished();
  if (!isCurrent()) return;
  await ensureLocalScreenPublished(room, isCurrent);
  if (!isCurrent()) return;
  syncLiveKitVoiceSubscriptions();
  syncRemoteAudioPlayback();
  refreshParticipantState();
}

function retryDemandedScreenSubscriptions(room: Room): void {
  room.remoteParticipants.forEach((participant) => {
    const peer = state.peers.get(participant.identity);
    if (!peer) return;

    participant.trackPublications.forEach((publication) => {
      if (!isScreenPublication(publication) || !shouldSubscribeToScreen(peer)) return;
      const remotePublication = publication as RemoteTrackPublication;
      if (attachSubscribedRemoteScreenTrack(peer, remotePublication)) return;
      void scheduleScreenSubscriptionRetry(peer, remotePublication);
    });
  });
}

function ensureRemoteMicrophonePlayback(peer: Participant, publication: TrackPublication): void {
  if (!isMicrophonePublication(publication)) return;
  if (state.outputMuted) return;

  const remotePublication = publication as RemoteTrackPublication;
  const track = remotePublication.track as RemoteTrack | null | undefined;
  const mediaTrack = track?.mediaStreamTrack;
  if (!mediaTrack || mediaTrack.kind !== 'audio' || mediaTrack.readyState === 'ended') return;
  if (remotePublication.isSubscribed === false) return;

  peer.voiceIssue = '';
  const stream = track.mediaStream || new MediaStream([mediaTrack]);
  peer.stream = stream;
  peer.micReceiver = track.receiver ?? peer.micReceiver;
  ensureRemoteAudioElement(peer, mediaTrack, stream, track.receiver);
  updatePeerStatus(peer);
}

async function ensureLocalMicrophonePublished(): Promise<void> {
  const existingPublication = findLocalMicrophonePublication();
  if (existingPublication) {
    state.localMicPublication = existingPublication;
    await syncLocalMicrophonePublicationMuted();
    return;
  }

  if (state.livekitRoom && state.localStream) {
    await publishLocalMicrophone();
  }
}

async function ensureLocalScreenPublished(room: Room, isCurrent: () => boolean): Promise<void> {
  const stream = state.localScreenStream;
  if (!stream || !isCurrent()) return;
  const publications = await publishLocalScreenTracksForRoom(
    room,
    stream,
    () => isCurrent() && state.livekitRoom === room && state.localScreenStream === stream,
    state.localScreenPublications
  );
  if (isCurrent() && state.livekitRoom === room && state.localScreenStream === stream) {
    state.localScreenPublications = publications;
  }
}

export function findLocalMicrophonePublication(): LocalTrackPublication | null {
  const publications = state.livekitRoom?.localParticipant?.trackPublications;
  if (!publications?.values) return null;
  return [...publications.values()].find(isMicrophonePublication) || null;
}

function handleLiveKitTrackSubscribed(
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
): void {
  if (isMusicBotIdentity(participant.identity)) {
    handleMusicPublication(participant.identity, publication, track);
    return;
  }
  const peer = createLiveKitParticipant(participant);
  if (!peer) return;
  updateLiveKitPublicationState(peer, publication);

  const mediaTrack = track.mediaStreamTrack;
  if (
    peer.screenAuthoritative === false &&
    (isScreenVideoPublication(publication) || isScreenAudioPublication(publication))
  ) {
    clearScreenSubscriptionRetry(publication);
    publication.setSubscribed(false);
    detachRemoteScreen(peer);
    return;
  }

  const stream = track.mediaStream || new MediaStream([mediaTrack]);
  if (isScreenVideoPublication(publication)) {
    screenRecoveryGrace.cancel(peer.id);
    void applyRemoteScreenVideoDemand(peer, publication);
    attachRemoteScreenStream(peer, stream);
    if (mediaTrack.readyState !== 'ended') clearScreenSubscriptionRetry(publication);
    else void scheduleScreenSubscriptionRetry(peer, publication);
    return;
  }

  if (isScreenAudioPublication(publication)) {
    screenRecoveryGrace.cancel(peer.id);
    attachRemoteScreenStream(peer, stream);
    if (mediaTrack.readyState !== 'ended') clearScreenSubscriptionRetry(publication);
    else void scheduleScreenSubscriptionRetry(peer, publication);
    return;
  }

  if (isMicrophonePublication(publication)) {
    peer.voiceIssue = '';
    attachRemoteTrack(peer, mediaTrack, stream, track.receiver);
    updatePeerStatus(peer);
  }
}

function handleLiveKitTrackUnsubscribed(
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
): void {
  if (isMusicBotIdentity(participant.identity)) {
    handleMusicPublicationGone(participant.identity, publication, track);
    return;
  }
  const peer = state.peers.get(participant.identity);
  if (!peer) return;

  if (isScreenVideoPublication(publication)) {
    detachRemoteScreenVideoTrack(peer, track.mediaStreamTrack.id);
    if (shouldSubscribeToScreen(peer)) void scheduleScreenSubscriptionRetry(peer, publication);
    return;
  }

  if (isScreenAudioPublication(publication)) {
    detachRemoteScreenAudioTrack(peer, track.mediaStreamTrack.id);
    if (shouldSubscribeToScreen(peer)) void scheduleScreenSubscriptionRetry(peer, publication);
    return;
  }

  if (isMicrophonePublication(publication)) {
    detachRemoteAudioTrack(peer, track.mediaStreamTrack.id);
    peer.micReceiver = null;
    if (!state.outputMuted) peer.voiceIssue = '';
    updatePeerStatus(peer);
  }
}

function handleLiveKitTrackUnpublished(publication: RemoteTrackPublication, participant: RemoteParticipant): void {
  // Ahead of `clearScreenSubscriptionRetry`: the bot's publication is
  // ScreenShareAudio and has no business in the screen retry controller.
  if (isMusicBotIdentity(participant.identity)) {
    handleMusicPublicationGone(participant.identity, publication);
    return;
  }
  clearScreenSubscriptionRetry(publication);
  const peer = state.peers.get(participant.identity);
  if (!peer) return;

  const remainingPublications = participant.trackPublications
    ? [...participant.trackPublications.values()].filter((candidate) => candidate.trackSid !== publication.trackSid)
    : [];
  const screenPresence = getScreenPublicationPresence(
    remainingPublications,
    isScreenVideoPublication,
    isScreenAudioPublication
  );

  if (isScreenAudioPublication(publication)) {
    if (!screenPresence.active) {
      const audioTrackId = publication.track?.mediaStreamTrack?.id;
      if (audioTrackId) detachRemoteScreenAudioTrack(peer, audioTrackId);
      scheduleRemoteScreenLoss(peer.id);
      return;
    }
    const hadScreen = peer.screen;
    peer.screen = peer.screenAuthoritative === false ? false : screenPresence.active;
    peer.screenAudio = screenPresence.hasAudio;
    const audioTrackId = publication.track?.mediaStreamTrack?.id;
    if (audioTrackId) detachRemoteScreenAudioTrack(peer, audioTrackId);
    applyRemoteScreenCue(peer, hadScreen, peer.screen);
    if (!peer.screen) detachRemoteScreen(peer);
    refreshScreenAction(peer);
    refreshScreenTiles();
    refreshScreenStage();
    return;
  }

  if (isScreenVideoPublication(publication)) {
    if (!screenPresence.active) {
      const videoTrackId = publication.track?.mediaStreamTrack?.id;
      if (videoTrackId) detachRemoteScreenVideoTrack(peer, videoTrackId);
      scheduleRemoteScreenLoss(peer.id);
      return;
    }
    const hadScreen = peer.screen;
    peer.screen = peer.screenAuthoritative === false ? false : screenPresence.active;
    peer.screenAudio = screenPresence.hasAudio;

    applyRemoteScreenCue(peer, hadScreen, peer.screen);
    const videoTrackId = publication.track?.mediaStreamTrack?.id;
    if (videoTrackId) detachRemoteScreenVideoTrack(peer, videoTrackId);
    if (!screenPresence.hasVideo) detachRemoteScreenVideoTracks(peer);
    refreshScreenAction(peer);
    refreshScreenTiles();
    refreshScreenStage();
    return;
  }

  if (isMicrophonePublication(publication)) {
    peer.micReceiver = null;
    peer.voiceIssue = '';
    updatePeerStatus(peer);
  }
}

function scheduleRemoteScreenLoss(peerId: string): void {
  screenRecoveryGrace.schedule(peerId, () => finalizeRemoteScreenLoss(peerId));
}

function finalizeRemoteScreenLoss(peerId: string): void {
  const peer = state.peers.get(peerId);
  if (!peer) return;
  const publications = peer.livekitParticipant?.trackPublications?.values
    ? [...peer.livekitParticipant.trackPublications.values()]
    : [];
  const presence = getScreenPublicationPresence(publications, isScreenVideoPublication, isScreenAudioPublication);
  if (presence.active) {
    screenRecoveryGrace.cancel(peerId);
    return;
  }
  const hadScreen = peer.screen;
  peer.screen = false;
  peer.screenAudio = false;
  detachRemoteScreen(peer);
  applyRemoteScreenCue(peer, hadScreen, false);
  refreshScreenAction(peer);
  refreshScreenTiles();
  refreshScreenStage();
}

export function syncAuthoritativeScreenPresence(peerId: string, screen: boolean): void {
  const peer = state.peers.get(peerId);
  if (peer) {
    peer.screenAuthoritative = screen;
    if (!screen) {
      peer.screen = false;
      peer.screenAudio = false;
      detachRemoteScreen(peer);
    }
  }
  if (screen) {
    screenRecoveryGrace.cancel(peerId);
    return;
  }
  screenRecoveryGrace.authoritativeStop(peerId);
}

export function isMicrophonePublication(publication: TrackPublication | null | undefined): boolean {
  return publication?.source === TRACK_SOURCE.Microphone;
}

export function isScreenPublication(publication: TrackPublication | null | undefined): boolean {
  return isScreenVideoPublication(publication) || isScreenAudioPublication(publication);
}

export function isScreenVideoPublication(publication: TrackPublication | null | undefined): boolean {
  return publication?.source === TRACK_SOURCE.ScreenShare;
}

export function isScreenAudioPublication(publication: TrackPublication | null | undefined): boolean {
  return publication?.source === TRACK_SOURCE.ScreenShareAudio;
}

export function findFirstLocalPublication(): LocalTrackPublication | null {
  return state.livekitRoom?.localParticipant?.trackPublications?.values?.().next?.().value || null;
}
