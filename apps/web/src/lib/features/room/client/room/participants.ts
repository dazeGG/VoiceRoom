import { closeParticipantContextMenu } from '../../participant-context-ui.svelte';
import { bumpParticipantsRevision, participantsUi } from '../../participants-ui.svelte';
import { state } from '../core/state.svelte';
import { getScreenProfile } from '../media/profiles';
import {
  applyAudioOutputDevice,
  applyRemoteParticipantAudioPreferences,
  playMediaElement,
  releaseRemoteAudioElement
} from '../services/media-playback-service';
import { STREAM_CUE_DEDUPE_MS } from '../core/config';
import { clearPeerJoinCue, playStreamCue, playStreamViewerCue } from '../media/cues';
import { attachMeter } from '../media/meters';
import { syncLiveKitScreenSubscriptions } from '../services/livekit-service';
import {
  closeScreenView,
  hideScreenStage,
  refreshAllScreenActions,
  refreshScreenStage,
  refreshScreenTiles
} from '../ui/screen-view';
import type { Participant, PeerInfo } from '../core/types';

const watchedRemoteScreenTracks = new WeakSet<MediaStreamTrack>();
const streamCueTimes = new Map<string, number>();

function createParticipantModel(peerInfo: PeerInfo, isLocal: boolean): Participant {
  const name = peerInfo.name ?? '';
  return {
    accountUserId: peerInfo.accountUserId || '',
    analyser: null,
    audioElements: new Map(),
    avatarColorKey: peerInfo.avatarColorKey || '',
    deafened: Boolean(peerInfo.deafened),
    id: peerInfo.id,
    incomingVoiceActive: false,
    isLocal,
    joinedAt: peerInfo.joinedAt ?? Date.now(),
    livekitParticipant: null,
    connectionQuality: 'unknown',
    meterData: null,
    muted: Boolean(peerInfo.muted),
    speaking: false,
    statusLabel: '',
    level: 0,
    name,
    micReceiver: null,
    screen: Boolean(peerInfo.screen),
    screenAudio: Boolean(peerInfo.screenAudio),
    screenProfileId: getScreenProfile(peerInfo.screenProfileId ?? '').id,
    screenStream: null,
    screenStreamId: peerInfo.screenStreamId || '',
    stream: null,
    viewedScreenPeerId: peerInfo.viewedScreenPeerId || '',
    voiceIssue: ''
  };
}

export function applyRemoteScreenCue(participant: Participant, hadScreen: boolean, nextScreen: boolean): void {
  if (participant.isLocal || hadScreen === nextScreen) return;

  const dedupeKey = `${participant.id}:${nextScreen ? 'start' : 'stop'}`;
  const now = Date.now();
  const lastPlayedAt = streamCueTimes.get(dedupeKey) || 0;
  if (now - lastPlayedAt < STREAM_CUE_DEDUPE_MS) return;

  streamCueTimes.set(dedupeKey, now);
  playStreamCue(nextScreen ? 'start' : 'stop');
}

export function clearRemoteScreenCue(peerId: string | undefined): void {
  if (!peerId) return;
  streamCueTimes.delete(`${peerId}:start`);
  streamCueTimes.delete(`${peerId}:stop`);
}

function getAttendedStreamOwnerIds(): Set<string> {
  const ownerIds = new Set(state.screenSubscribedPeerIds);
  if (state.viewedScreenPeerId) ownerIds.add(state.viewedScreenPeerId);
  return ownerIds;
}

export function applyStreamViewerCue(
  participant: Participant,
  hadViewedOwnerId: string,
  nextViewedOwnerId: string
): void {
  if (participant.isLocal || hadViewedOwnerId === nextViewedOwnerId) return;

  const attendedOwnerIds = getAttendedStreamOwnerIds();
  if (attendedOwnerIds.size === 0) return;

  for (const ownerId of attendedOwnerIds) {
    if (hadViewedOwnerId !== ownerId && nextViewedOwnerId === ownerId) {
      playStreamViewerCue('join');
      return;
    }
    if (hadViewedOwnerId === ownerId && nextViewedOwnerId !== ownerId) {
      playStreamViewerCue('leave');
      return;
    }
  }
}

export function syncPeers(peerIds: string[]): void {
  const livePeerIds = new Set(peerIds);
  for (const peerId of state.peers.keys()) {
    if (!livePeerIds.has(peerId)) {
      removePeer(peerId);
      clearPeerJoinCue(peerId);
    }
  }
}

export function createParticipant(peerInfo: PeerInfo): Participant {
  const isLocal = Boolean(peerInfo.isLocal || peerInfo.id === state.peerId);
  peerInfo.isLocal = isLocal;

  const existing = isLocal ? state.self : state.peers.get(peerInfo.id);
  if (existing) {
    if (isLocal) {
      const duplicate = state.peers.get(peerInfo.id);
      if (duplicate) state.peers.delete(duplicate.id);
    }
    updateParticipant(peerInfo);
    return existing;
  }

  const participant = createParticipantModel(peerInfo, isLocal);

  if (participant.isLocal) {
    state.self = participant;
    state.peers.delete(peerInfo.id);
  } else {
    state.peers.set(peerInfo.id, participant);
  }

  refreshAllScreenActions();
  refreshParticipantState();
  if (!participant.isLocal && participant.screen) {
    applyRemoteScreenCue(participant, false, true);
  }
  return participant;
}

export function updateParticipant(peerInfo: PeerInfo): void {
  const participant = peerInfo.id === state.peerId ? state.self : state.peers.get(peerInfo.id);
  if (!participant) return;

  const hadScreen = participant.screen;
  const hadScreenAudio = participant.screenAudio;
  const hadScreenStreamId = participant.screenStreamId;
  const hadName = participant.name;
  const hadAccountUserId = participant.accountUserId;
  const hasScreenUpdate = Object.hasOwn(peerInfo, 'screen');
  if (Object.hasOwn(peerInfo, 'accountUserId')) participant.accountUserId = peerInfo.accountUserId || '';
  if (Object.hasOwn(peerInfo, 'avatarColorKey')) participant.avatarColorKey = peerInfo.avatarColorKey || participant.avatarColorKey;
  if (Object.hasOwn(peerInfo, 'name')) participant.name = peerInfo.name || participant.name;
  if (Object.hasOwn(peerInfo, 'deafened')) participant.deafened = Boolean(peerInfo.deafened);
  if (Object.hasOwn(peerInfo, 'muted')) participant.muted = Boolean(peerInfo.muted);
  if (hasScreenUpdate) participant.screen = Boolean(peerInfo.screen);
  if (Object.hasOwn(peerInfo, 'screenAudio')) participant.screenAudio = Boolean(peerInfo.screenAudio);
  if (Object.hasOwn(peerInfo, 'screenProfileId')) participant.screenProfileId = getScreenProfile(peerInfo.screenProfileId ?? '').id;
  if (Object.hasOwn(peerInfo, 'screenStreamId')) participant.screenStreamId = peerInfo.screenStreamId || '';
  const hadViewedScreenOwnerId = participant.viewedScreenPeerId;
  if (Object.hasOwn(peerInfo, 'viewedScreenPeerId')) {
    participant.viewedScreenPeerId = peerInfo.viewedScreenPeerId || '';
    applyStreamViewerCue(participant, hadViewedScreenOwnerId, participant.viewedScreenPeerId);
  }
  if (Object.hasOwn(peerInfo, 'muted') && participant.muted) {
    participant.incomingVoiceActive = false;
    setParticipantSpeaking(participant, false);
  }
  if (hasScreenUpdate) {
    applyRemoteScreenCue(participant, hadScreen, participant.screen);
  }
  if (!participant.screen) {
    state.screenCollapsedPeerIds.delete(participant.id);
    state.screenSubscribedPeerIds.delete(participant.id);
    if (state.viewedScreenPeerId === participant.id) {
      closeScreenView();
    }
  }
  if (!participant.screen && state.sharedScreenPeerId === participant.id) {
    detachRemoteScreen(participant);
  }
  updatePeerStatus(participant);
  if (!participant.isLocal && participant.accountUserId !== hadAccountUserId) {
    applyRemoteParticipantAudioPreferences(participant);
  }
  refreshAllScreenActions();

  if (shouldRefreshScreenTiles(peerInfo, hadScreen, hadScreenAudio, hadScreenStreamId, hadName)) {
    refreshScreenTiles();
  }

  if (shouldRefreshScreenStage(peerInfo, hadScreen, hadScreenAudio, hadScreenStreamId, hadName)) {
    refreshScreenStage();
  }

  refreshParticipantState();
}

function shouldRefreshScreenTiles(
  peerInfo: PeerInfo,
  hadScreen: boolean,
  hadScreenAudio: boolean,
  hadScreenStreamId: string,
  hadName: string
): boolean {
  if (Object.hasOwn(peerInfo, 'name') && (peerInfo.name || '') !== hadName) return true;
  if (Object.hasOwn(peerInfo, 'screen') && Boolean(peerInfo.screen) !== hadScreen) return true;
  if (Object.hasOwn(peerInfo, 'screenAudio') && Boolean(peerInfo.screenAudio) !== hadScreenAudio) return true;
  if (Object.hasOwn(peerInfo, 'screenStreamId') && (peerInfo.screenStreamId || '') !== hadScreenStreamId) return true;
  return false;
}

function shouldRefreshScreenStage(
  peerInfo: PeerInfo,
  hadScreen: boolean,
  hadScreenAudio: boolean,
  hadScreenStreamId: string,
  hadName: string
): boolean {
  if (shouldRefreshScreenTiles(peerInfo, hadScreen, hadScreenAudio, hadScreenStreamId, hadName)) return true;
  if (Object.hasOwn(peerInfo, 'screenProfileId')) return true;
  return false;
}

export function removePeer(peerId: string): void {
  const peer = state.peers.get(peerId);
  if (!peer) return;
  closeParticipantContextMenu(peerId);

  applyStreamViewerCue(peer, peer.viewedScreenPeerId, '');
  clearPeerJoinCue(peerId);
  clearRemoteScreenCue(peerId);
  removeAudioElements(peer);
  state.screenCollapsedPeerIds.delete(peerId);
  state.screenSubscribedPeerIds.delete(peerId);
  if (state.viewedScreenPeerId === peer.id) {
    closeScreenView();
  }
  if (state.sharedScreenPeerId === peer.id) {
    hideScreenStage();
  }
  state.peers.delete(peerId);
  if (state.peers.size === 0) setParticipantSpeaking(state.self, false);
  refreshScreenTiles();
  refreshParticipantState();

}

export function detachLiveKitParticipant(peer: Participant, voiceIssue = ''): void {
  peer.livekitParticipant = null;
  peer.voiceIssue = voiceIssue;
  peer.micReceiver = null;
  removeAudioElements(peer);
  peer.incomingVoiceActive = false;
  setParticipantSpeaking(peer, false);
  updatePeerStatus(peer);
}

export function attachRemoteTrack(
  peer: Participant,
  track: MediaStreamTrack,
  stream: MediaStream | null,
  receiver: RTCRtpReceiver | null | undefined = null
): void {
  const mediaStream = stream || new MediaStream([track]);
  const isScreenStream = isRemoteScreenTrack(peer, track, mediaStream);

  if (isScreenStream) {
    attachRemoteScreenStream(peer, mediaStream);
    return;
  }

  if (track.kind === 'audio') {
    peer.stream = mediaStream;
    peer.micReceiver = receiver ?? null;
    ensureRemoteAudioElement(peer, track, mediaStream, receiver);
    if (!peer.analyser) attachMeter(peer, new MediaStream([track]));
    updatePeerStatus(peer);
  }
}

function isRemoteScreenTrack(peer: Participant, track: MediaStreamTrack, stream: MediaStream): boolean {
  if (track.kind === 'video') return true;
  if (peer.screenStreamId && stream.id === peer.screenStreamId) return true;
  if (track.kind !== 'audio' || !peer.screen || !peer.screenAudio) return false;

  const alreadyHasMicAudio = Boolean(peer.stream?.getAudioTracks().some((audioTrack) => audioTrack.readyState !== 'ended'));
  const subscribed = state.viewedScreenPeerId === peer.id || state.screenSubscribedPeerIds.has(peer.id);
  const alreadyWatchingScreen = subscribed || Boolean(peer.screenStream);
  return alreadyHasMicAudio && alreadyWatchingScreen;
}

export function attachRemoteScreenStream(peer: Participant, stream: MediaStream): void {
  const screenStream = mergeRemoteScreenStream(peer, stream);
  peer.screen = true;
  peer.screenStream = screenStream;
  peer.screenAudio = peer.screenAudio || screenStream.getAudioTracks().some((track) => track.readyState !== 'ended');
  peer.screenStreamId ||= screenStream.id;

  for (const track of screenStream.getVideoTracks()) {
    if (watchedRemoteScreenTracks.has(track)) continue;
    watchedRemoteScreenTracks.add(track);
    track.addEventListener('ended', () => detachRemoteScreen(peer), { once: true });
  }
  for (const track of screenStream.getAudioTracks()) {
    if (watchedRemoteScreenTracks.has(track)) continue;
    watchedRemoteScreenTracks.add(track);
    track.addEventListener(
      'ended',
      () => {
        peer.screenAudio = false;
        refreshScreenStage();
      },
      { once: true }
    );
  }

  const subscribed = state.viewedScreenPeerId === peer.id || state.screenSubscribedPeerIds.has(peer.id);
  if (!subscribed) {
    syncLiveKitScreenSubscriptions(peer);
    detachRemoteScreen(peer);
    return;
  }

  state.screenRequesting = false;
  refreshAllScreenActions();
  refreshScreenStage();
  refreshScreenTiles();
  updatePeerStatus(peer);
  refreshParticipantState();
}

function mergeRemoteScreenStream(peer: Participant, stream: MediaStream): MediaStream {
  if (!peer.screenStream || peer.screenStream === stream) return stream;

  const existingTrackIds = new Set(peer.screenStream.getTracks().map((track) => track.id));
  for (const track of stream.getTracks()) {
    if (!existingTrackIds.has(track.id)) peer.screenStream.addTrack(track);
  }

  return peer.screenStream;
}

export function detachRemoteScreen(peer: Participant): void {
  peer.screenStream = null;
  if (state.sharedScreenPeerId === peer.id) hideScreenStage();
  refreshScreenStage();
  updatePeerStatus(peer);
  refreshAllScreenActions();
  refreshParticipantState();
}

export function ensureRemoteAudioElement(
  peer: Participant,
  track: MediaStreamTrack,
  stream: MediaStream | null = null,
  receiver: RTCRtpReceiver | null | undefined = null
): void {
  if (track.kind !== 'audio' || track.readyState === 'ended') return;

  const audio = peer.audioElements.get(track.id);
  const existingStream = audio?.srcObject instanceof MediaStream ? audio.srcObject : null;
  const existingHasLiveTrack = Boolean(
    existingStream?.getAudioTracks().some((audioTrack) => audioTrack === track && audioTrack.readyState !== 'ended')
  );

  if (audio && existingHasLiveTrack) {
    if (!audio.isConnected) document.body.append(audio);
    applyRemoteParticipantAudioPreferences(peer);
    playMediaElement(audio);
    return;
  }

  if (audio) {
    audio.pause();
    audio.srcObject = null;
    releaseRemoteAudioElement(audio);
    audio.remove();
  }

  attachRemoteAudioTrack(peer, track, stream, receiver);
}

function attachRemoteAudioTrack(
  peer: Participant,
  track: MediaStreamTrack,
  stream: MediaStream | null = null,
  receiver: RTCRtpReceiver | null | undefined = null
): void {
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.muted = true;
  (audio as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
  audio.srcObject = stream || new MediaStream([track]);
  peer.audioElements.set(track.id, audio);
  document.body.append(audio);
  applyRemoteParticipantAudioPreferences(peer);
  applyAudioOutputDevice(audio).catch(() => {});
  playMediaElement(audio);

  track.addEventListener(
    'ended',
    () => {
      releaseRemoteAudioElement(audio);
      audio.remove();
      peer.audioElements.delete(track.id);
      if (peer.micReceiver === receiver) peer.micReceiver = null;
      peer.incomingVoiceActive = false;
      setParticipantSpeaking(peer, false);
    },
    { once: true }
  );
}

export function detachRemoteAudioTrack(peer: Participant, trackId: string): void {
  const audio = peer.audioElements.get(trackId);
  if (!audio) return;

  audio.pause();
  audio.srcObject = null;
  releaseRemoteAudioElement(audio);
  audio.remove();
  peer.audioElements.delete(trackId);
}

export function removeAudioElements(peer: Participant): void {
  for (const audio of peer.audioElements.values()) {
    releaseRemoteAudioElement(audio);
    audio.remove();
  }
  peer.audioElements.clear();
}

export function setParticipantSpeaking(participant: Participant | null, speaking: boolean): void {
  if (!participant) return;
  const nextSpeaking = Boolean(speaking);
  if (participant.speaking === nextSpeaking) return;
  participant.speaking = nextSpeaking;
  refreshParticipantState();
}

export function updatePeerStatus(peer: Participant): void {
  if (!peer.isLocal && peer.voiceIssue) {
    setParticipantStatus(peer, peer.voiceIssue);
    return;
  }

  if (peer.screen) {
    setParticipantStatus(peer, peer.isLocal ? 'экран в эфире' : 'показывает экран');
    return;
  }

  if (!peer.isLocal && peer.livekitParticipant) {
    setParticipantStatus(peer, '');
    return;
  }

  if (peer.muted || peer.isLocal) {
    setParticipantStatus(peer, '');
    return;
  }

  setParticipantStatus(peer, '');
}

function setParticipantStatus(peer: Participant, label: string): void {
  if (peer.statusLabel === label) return;
  peer.statusLabel = label;
  refreshParticipantState();
}

export function refreshParticipantState(): void {
  bumpParticipantsRevision();
}

export function refreshStageGridState(): void {
  bumpParticipantsRevision();
}

export function getParticipantById(peerId: string): Participant | null {
  if (!peerId) return null;
  if (peerId === state.peerId) return state.self;
  return state.peers.get(peerId) || null;
}

export function getAllParticipants(): Participant[] {
  void participantsUi.revision;
  return [
    ...(state.self ? [state.self] : []),
    ...state.peers.values()
  ];
}