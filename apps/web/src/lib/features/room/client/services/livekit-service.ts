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
import { elements } from '../ui/dom';
import { state } from '../core/state.svelte';
import { setVoiceConnectionStatus } from '../ui/status';
import { showToast } from '../ui/toast';
import { postJson } from '../net/api';
import { queueAudioUnlock, syncRemoteAudioPlayback } from './media-playback-service';
import { clearPeerJoinCue } from '../media/cues';
import { refreshCallControls } from '../ui/controls';
import { errorMessage } from '../core/utils';
import { getScreenProfile, getScreenPublishVideoOptions } from '../media/profiles';
import { loadLiveKitClient, TRACK_SOURCE } from '../media/livekit-runtime';
import {
  applyRemoteScreenCue,
  attachRemoteScreenStream,
  attachRemoteTrack,
  createParticipant,
  ensureRemoteAudioElement,
  detachLiveKitParticipant,
  detachRemoteAudioTrack,
  detachRemoteScreen,
  refreshParticipantState,
  removePeer,
  setParticipantSpeaking,
  updateParticipant,
  updatePeerStatus
} from '../room/participants';
import { refreshScreenControls } from './screen-share-service';
import { refreshScreenAction, refreshScreenStage, refreshScreenTiles } from '../ui/screen-view';
import type { Participant } from '../core/types';

export async function connectLiveKitRoom(name: string): Promise<void> {
  setVoiceConnectionStatus('connecting');

  const credentials = await postJson('/api/livekit-token', {
    name,
    peerId: state.peerId,
    roomId: state.roomId,
    sessionToken: state.sessionToken
  });

  const room = await connectLiveKitWithFallback(credentials);

  await publishLocalMicrophone();
  syncLiveKitParticipants(room);
  setVoiceConnectionStatus('connected');
}

async function connectLiveKitWithFallback(credentials: { url: string; token: string }): Promise<Room> {
  const { Room } = await loadLiveKitClient();
  const urls = getLiveKitConnectUrls(credentials.url);
  let lastError: unknown = null;

  for (const url of urls) {
    const room = new Room({
      adaptiveStream: true,
      dynacast: true
    });
    state.livekitRoom = room;
    await bindLiveKitRoomEvents(room);

    try {
      await room.connect(url, credentials.token, {
        autoSubscribe: false
      });
      logLocalLiveKitDebug('info', `LiveKit connected to ${url}`);
      return room;
    } catch (error) {
      lastError = error;
      logLocalLiveKitDebug('warn', `LiveKit connect failed for ${url}`, error);
      state.livekitRoom = null;
      await room.disconnect(false).catch(() => {});
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

async function bindLiveKitRoomEvents(room: Room): Promise<void> {
  const { RoomEvent } = await loadLiveKitClient();

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
  room.on(RoomEvent.TrackSubscriptionFailed, (_trackSid, participant) => {
    if (!participant) return;
    const peer = state.peers.get(participant.identity) || syncLiveKitParticipant(participant);
    if (!peer) return;
    peer.voiceIssue = 'голос не подключен';
    updatePeerStatus(peer);
  });
  room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (room.canPlaybackAudio === false) {
      queueAudioUnlock({ showFallback: true });
      setVoiceConnectionStatus('playback-blocked');
    } else if (state.voiceConnection === 'playback-blocked') {
      state.audioUnlockPending = false;
      elements.soundButton.hidden = true;
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
  room.on(RoomEvent.TrackMuted, (publication, participant) => {
    const peer = createLiveKitParticipant(participant);
    if (!peer) return;
    if (isMicrophonePublication(publication)) {
      updateParticipant({ id: peer.id, muted: true });
    }
  });
  room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
    const peer = createLiveKitParticipant(participant);
    if (!peer) return;
    if (isMicrophonePublication(publication)) {
      updateParticipant({ id: peer.id, muted: false });
    }
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

  const peer = createParticipant({
    deafened: getLiveKitBooleanAttribute(participant, 'deafened'),
    id: participant.identity,
    isLocal: participant.isLocal || participant.identity === state.peerId,
    joinedAt: participant.joinedAt ? participant.joinedAt.getTime() : Date.now(),
    muted: !participant.isMicrophoneEnabled || getLiveKitBooleanAttribute(participant, 'muted'),
    name: participant.name || participant.identity,
    screen: participant.isScreenShareEnabled
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

function getLiveKitBooleanAttribute(participant: LiveKitParticipant, name: string): boolean {
  return participant?.attributes?.[name] === 'true';
}

export async function publishLocalMicrophone(): Promise<void> {
  if (!state.livekitRoom || !state.localStream) return;
  const [track] = state.localStream.getAudioTracks();
  if (!track) throw new Error('Браузер не отдал аудио-трек');

  state.localMicPublication = await state.livekitRoom.localParticipant.publishTrack(track, {
    audioPreset: { maxBitrate: MICROPHONE_AUDIO_BITRATE },
    dtx: true,
    name: 'microphone',
    red: true,
    source: TRACK_SOURCE.Microphone as Track.Source
  });
  await syncLocalMicrophonePublicationMuted();
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
  state.livekitRoom = null;
  state.localMicPublication = null;
  state.localScreenPublications.clear();
  if (!room) return;

  try {
    room.removeAllListeners?.();
    await room.disconnect(false);
  } catch (error) {
    console.warn('LiveKit disconnect failed', error);
  }
}

export function updateLiveKitPublicationState(peer: Participant, publication: TrackPublication): void {
  if (isScreenPublication(publication)) {
    const hadScreen = peer.screen;
    peer.screen = true;
    peer.screenAudio = peer.screenAudio || isScreenAudioPublication(publication);
    applyRemoteScreenCue(peer, hadScreen, true);
    updatePeerStatus(peer);
    refreshScreenAction(peer);
    if (!hadScreen) refreshScreenTiles();
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
    setRemotePublicationSubscribed(
      remotePublication,
      state.viewedScreenPeerId === peer.id || state.screenSubscribedPeerIds.has(peer.id)
    );
  }
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
  if (publication.isSubscribed === subscribed) return;
  publication.setSubscribed(subscribed);
}

async function recoverLiveKitRoom(room: Room): Promise<void> {
  syncLiveKitParticipants(room);
  await ensureLocalMicrophonePublished();
  syncLiveKitVoiceSubscriptions();
  syncRemoteAudioPlayback();
  refreshParticipantState();
  refreshCallControls();
  refreshScreenControls();
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
  if (isScreenPublication(publication)) {
    attachRemoteScreenStream(peer, stream);
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

  if (isScreenPublication(publication)) {
    detachRemoteScreen(peer);
    return;
  }

  if (isMicrophonePublication(publication)) {
    detachRemoteAudioTrack(peer, track.mediaStreamTrack.id);
    peer.micReceiver = null;
    if (!state.outputMuted) peer.voiceIssue = 'подключает голос';
    updatePeerStatus(peer);
  }
}

function handleLiveKitTrackUnpublished(publication: RemoteTrackPublication, participant: RemoteParticipant): void {
  const peer = state.peers.get(participant.identity);
  if (!peer) return;

  if (isScreenPublication(publication)) {
    const hadScreen = peer.screen;
    peer.screen = participant.isScreenShareEnabled;
    peer.screenAudio = participant.trackPublications
      ? [...participant.trackPublications.values()].some(isScreenAudioPublication)
      : false;

    applyRemoteScreenCue(peer, hadScreen, peer.screen);
    if (!peer.screen) detachRemoteScreen(peer);
    refreshScreenAction(peer);
    refreshScreenTiles();
    if (!peer.screen) refreshScreenStage();
    return;
  }

  if (isMicrophonePublication(publication)) {
    peer.micReceiver = null;
    peer.voiceIssue = 'подключает голос';
    updatePeerStatus(peer);
  }
}

export function isMicrophonePublication(publication: TrackPublication | null | undefined): boolean {
  return publication?.source === TRACK_SOURCE.Microphone;
}

export function isScreenPublication(publication: TrackPublication | null | undefined): boolean {
  return publication?.source === TRACK_SOURCE.ScreenShare || publication?.source === TRACK_SOURCE.ScreenShareAudio;
}

export function isScreenAudioPublication(publication: TrackPublication | null | undefined): boolean {
  return publication?.source === TRACK_SOURCE.ScreenShareAudio;
}

export function findFirstLocalPublication(): LocalTrackPublication | null {
  return state.livekitRoom?.localParticipant?.trackPublications?.values?.().next?.().value || null;
}
