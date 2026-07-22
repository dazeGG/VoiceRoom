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
import { postJson } from '../net/api';
import { queueAudioUnlock, syncRemoteAudioPlayback } from './media-playback-service';
import { clearPeerJoinCue } from '../media/cues';
import { errorMessage } from '../core/utils';
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

const screenSubscriptionRetryController = createScreenSubscriptionRetryController();

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

async function connectLiveKitWithFallback(
  credentials: { url: string; urls?: string[]; token: string },
  isCurrent: () => boolean
): Promise<Room | null> {
  const { Room } = await loadLiveKitClient();
  if (!isCurrent()) return null;
  const configuredUrls = credentials.urls?.length ? credentials.urls : [credentials.url];
  const urls = [...new Set(configuredUrls.flatMap(getLiveKitConnectUrls))];
  let lastError: unknown = null;

  for (const url of urls) {
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
      logLocalLiveKitDebug('info', `LiveKit connected to ${url}`);
      return room;
    } catch (error) {
      lastError = error;
      logLocalLiveKitDebug('warn', `LiveKit connect failed for ${url}`, error);
      await room.disconnect(false).catch(() => {});
      if (!isCurrent()) return null;
    }
  }

  throw new Error(`${errorMessage(lastError) || 'LiveKit connection failed'} (${urls.join(', ')})`);
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

function logLocalLiveKitDebug(level: 'info' | 'warn', ...args: unknown[]): void {
  if (!['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return;
  console[level](...args);
}

async function bindLiveKitRoomEvents(room: Room, isCurrent: () => boolean): Promise<boolean> {
  const { RoomEvent } = await loadLiveKitClient();
  if (!isCurrent() || state.livekitRoom !== room) return false;

  room.on(RoomEvent.Connected, () => {
    if (state.voiceConnection !== 'connected') setVoiceConnectionStatus('connecting');
  });
  room.on(RoomEvent.Reconnecting, () => {
    if (state.joined || state.connecting) setVoiceConnectionStatus('reconnecting');
  });
  room.on(RoomEvent.Reconnected, () => {
    if (state.joined || state.connecting) setVoiceConnectionStatus('connected');
    recoverLiveKitRoom(room).catch((error) => console.warn('LiveKit recovery failed', error));
  });
  room.on(RoomEvent.Disconnected, () => {
    if (state.joined) setVoiceConnectionStatus('lost');
  });
  room.on(RoomEvent.ParticipantConnected, (participant) => {
    syncLiveKitParticipant(participant);
    refreshParticipantState();
  });
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    const peer = state.peers.get(participant.identity);
    if (peer) detachLiveKitParticipant(peer, 'голос переподключается');
    refreshParticipantState();
  });
  room.on(RoomEvent.SignalReconnecting, () => {
    if (state.joined || state.connecting) setVoiceConnectionStatus('signal-reconnecting');
  });
  room.on(RoomEvent.SignalConnected, () => {
    if (state.voiceConnection === 'signal-reconnecting') setVoiceConnectionStatus('connecting');
  });
  room.on(RoomEvent.LocalTrackPublished, (publication) => {
    if (!isMicrophonePublication(publication)) return;
    state.localMicPublication = publication;
    setVoiceConnectionStatus('connected');
  });
  room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
    if (!isMicrophonePublication(publication)) return;
    state.localMicPublication = null;
    if (state.joined) setVoiceConnectionStatus('reconnecting');
  });
  room.on(RoomEvent.TrackSubscriptionFailed, handleLiveKitTrackSubscriptionFailed);
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
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
    if (!state.muted) showToast('Микрофон не передает звук');
  });
  room.on(RoomEvent.TrackPublished, (publication, participant) => {
    const peer = createLiveKitParticipant(participant);
    if (!peer) return;
    updateLiveKitPublicationState(peer, publication);
    syncLiveKitPublicationSubscription(peer, publication);
  });
  room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
    handleLiveKitTrackUnpublished(publication, participant);
  });
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    handleLiveKitTrackSubscribed(track, publication, participant);
  });
  room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
    handleLiveKitTrackUnsubscribed(track, publication, participant);
  });
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const activeIds = new Set(speakers.map((participant) => participant.identity));
    for (const peer of state.peers.values()) {
      setParticipantSpeaking(peer, activeIds.has(peer.id));
    }
  });
  room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
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
    updateParticipant({ id: participant.identity, name: name || participant.identity });
  });
  return true;
}

export function syncLiveKitParticipants(room: Room | null): void {
  prunePeersOutsideServerList();
  if (!room) return;

  room.remoteParticipants.forEach((participant) => {
    syncLiveKitParticipant(participant);
  });
}

export function syncLiveKitParticipant(participant: RemoteParticipant | null | undefined): Participant | null {
  if (!participant || !isServerKnownRemotePeer(participant.identity)) return null;

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
  isCurrent: () => boolean
): Promise<boolean> {
  if (!stream || !isCurrent()) return false;
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
    return false;
  }
  state.localMicPublication = publication;
  await syncMicrophonePublicationMuted(publication);
  return isCurrent();
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
  if (!state.livekitRoom || !state.localScreenStream) return;
  const profile = getScreenProfile(state.localScreenProfileId);
  state.localScreenPublications.clear();

  for (const track of state.localScreenStream.getTracks()) {
    const videoOptions = track.kind === 'video' ? await getScreenPublishVideoOptions(profile) : null;
    const publication = await state.livekitRoom.localParticipant.publishTrack(track, {
      audioPreset: track.kind === 'audio' ? { maxBitrate: SCREEN_AUDIO_BITRATE } : undefined,
      ...(track.kind === 'audio' ? { dtx: false } : {}),
      name: track.kind === 'video' ? 'screen' : 'screen-audio',
      ...(videoOptions ?? {}),
      source: track.kind === 'video' ? videoOptions!.source : TRACK_SOURCE.ScreenShareAudio as Track.Source,
      stream: state.localScreenStream.id
    });
    state.localScreenPublications.set(track.id, publication);
  }
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
  clearAllScreenSubscriptionRetries();
  if (state.livekitRoom === room) {
    state.livekitRoom = null;
    state.localMicPublication = null;
    state.localScreenPublications.clear();
  }

  try {
    room.removeAllListeners?.();
    await room.disconnect(false);
  } catch (error) {
    console.warn('LiveKit disconnect failed', error);
  }
}

export function updateLiveKitPublicationState(peer: Participant, publication: TrackPublication): void {
  if (isScreenVideoPublication(publication)) {
    const hadScreen = peer.screen;
    peer.screen = true;
    applyRemoteScreenCue(peer, hadScreen, true);
    updatePeerStatus(peer);
    refreshScreenAction(peer);
    if (!hadScreen) refreshScreenTiles();
  }
  if (isScreenAudioPublication(publication)) {
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
    console.warn('LiveKit screen subscription codec is unsupported.', { trackSid: publication.trackSid });
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

async function recoverLiveKitRoom(room: Room): Promise<void> {
  // A reconnect is a new transport epoch. A screen SID that exhausted its
  // bounded retry budget on the previous connection must be eligible again;
  // otherwise a transient outage longer than the retry window can strand the
  // publication until the sender republishes it with a new SID.
  clearAllScreenSubscriptionRetries();
  syncLiveKitParticipants(room);
  retryDemandedScreenSubscriptions(room);
  await ensureLocalMicrophonePublished();
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
  const peer = createLiveKitParticipant(participant);
  if (!peer) return;
  updateLiveKitPublicationState(peer, publication);

  const mediaTrack = track.mediaStreamTrack;
  const stream = track.mediaStream || new MediaStream([mediaTrack]);
  if (isScreenVideoPublication(publication)) {
    void applyRemoteScreenVideoDemand(peer, publication);
    attachRemoteScreenStream(peer, stream);
    if (mediaTrack.readyState !== 'ended') clearScreenSubscriptionRetry(publication);
    else void scheduleScreenSubscriptionRetry(peer, publication);
    return;
  }

  if (isScreenAudioPublication(publication)) {
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
    const hadScreen = peer.screen;
    peer.screen = screenPresence.active;
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
    const hadScreen = peer.screen;
    peer.screen = screenPresence.active;
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
