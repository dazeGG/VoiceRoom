import { elements } from '../ui/dom';
import { state } from '../core/state';
import { getScreenProfile } from '../media/profiles';
import { getAvatarColor } from '$lib/visual/tokens';
import { getInitials } from '../core/utils';
import {
  applyAudioOutputDevice,
  isVoicePlaybackMuted,
  playMediaElement
} from '../services/media-playback-service';
import { STREAM_CUE_DEDUPE_MS } from '../core/config';
import { clearPeerJoinCue, playStreamCue, playStreamViewerCue } from '../media/cues';
import { attachMeter } from '../media/meters';
import { isMicrophonePublication, syncLiveKitScreenSubscriptions } from '../services/livekit-service';
import {
  closeScreenView,
  enterScreenView,
  getScreenParticipants,
  hideScreenStage,
  refreshAllScreenActions,
  refreshScreenAction,
  refreshScreenStage,
  refreshScreenTiles
} from '../ui/screen-view';
import type { Participant, ParticipantViewRefs, PeerInfo } from '../core/types';

const watchedRemoteScreenTracks = new WeakSet<MediaStreamTrack>();
const streamCueTimes = new Map<string, number>();

export function getParticipantView(participant: Participant | string | null | undefined): ParticipantViewRefs | null {
  const peerId = typeof participant === 'string' ? participant : participant?.id;
  return peerId ? state.participantViews.get(peerId) || null : null;
}

function setParticipantView(participant: Participant, view: ParticipantViewRefs): void {
  state.participantViews.set(participant.id, view);
}

export function removeParticipantView(peerId: string): void {
  const view = getParticipantView(peerId);
  view?.node.remove();
  state.participantViews.delete(peerId);
}

function requireParticipantView(participant: Participant): ParticipantViewRefs {
  const view = getParticipantView(participant);
  if (!view) throw new Error(`Missing participant view for ${participant.id}`);
  return view;
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
      if (duplicate) removeParticipantView(duplicate.id);
      state.peers.delete(peerInfo.id);
    }
    updateParticipant(peerInfo);
    return existing;
  }

  const fragment = elements.template.content.cloneNode(true) as DocumentFragment;
  const node = fragment.querySelector<HTMLElement>('.participant')!;
  const avatar = fragment.querySelector<HTMLElement>('.avatar')!;
  const nameLabel = fragment.querySelector<HTMLElement>('.participant-name')!;
  const screenAction = fragment.querySelector<HTMLButtonElement>('.participant-screen-action')!;
  const status = fragment.querySelector<HTMLParagraphElement>('p')!;

  const name = peerInfo.name ?? '';
  node.dataset.peerId = peerInfo.id;
  if (isLocal) node.dataset.local = 'true';
  avatar.textContent = getInitials(name);
  nameLabel.textContent = isLocal ? `${name} · вы` : name;
  const view = { node, screenAction, status };
  setParticipantStatus(view, isLocal ? '' : 'подключает голос');
  node.dataset.deafened = String(Boolean(peerInfo.deafened));
  node.dataset.muted = String(Boolean(peerInfo.muted));
  node.dataset.screen = String(Boolean(peerInfo.screen));
  applyParticipantPalette(node, peerInfo);

  elements.participants.append(node);

  const participant: Participant = {
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

  setParticipantView(participant, view);
  screenAction.addEventListener('click', () => enterScreenView(participant.id).catch((error) => console.error(error)));
  if (participant.isLocal) {
    state.self = participant;
    state.peers.delete(peerInfo.id);
  } else {
    state.peers.set(peerInfo.id, participant);
  }
  refreshScreenAction(participant);
  refreshScreenTiles();
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
  const hasScreenUpdate = Object.hasOwn(peerInfo, 'screen');
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
  const view = requireParticipantView(participant);
  view.node.dataset.deafened = String(participant.deafened);
  view.node.dataset.muted = String(participant.muted);
  view.node.dataset.screen = String(participant.screen);
  applyParticipantPalette(view.node, participant);
  view.node.querySelector('.avatar')!.textContent = getInitials(participant.name);
  view.node.querySelector('.participant-name')!.textContent = participant.isLocal ? `${participant.name} · вы` : participant.name;
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
  refreshScreenAction(participant);

  if (shouldRefreshScreenTiles(peerInfo, hadScreen, hadScreenAudio, hadScreenStreamId, hadName)) {
    refreshScreenTiles();
  }

  if (shouldRefreshScreenStage(peerInfo, hadScreen, hadScreenAudio, hadScreenStreamId, hadName)) {
    refreshScreenStage();
  }
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
  removeParticipantView(peerId);
  state.peers.delete(peerId);
  if (state.peers.size === 0) setParticipantSpeaking(state.self, false);
  refreshScreenTiles();
  refreshParticipantState();
}

export function detachLiveKitParticipant(peer: Participant, voiceIssue = 'подключает голос'): void {
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
    attachRemoteAudioTrack(peer, track);
    if (!peer.analyser) attachMeter(peer, new MediaStream([track]));
    track.addEventListener(
      'ended',
      () => {
        if (peer.micReceiver === receiver) peer.micReceiver = null;
        peer.incomingVoiceActive = false;
        setParticipantSpeaking(peer, false);
      },
      { once: true }
    );
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
  setParticipantScreenDataset(peer, true);

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
  setParticipantScreenDataset(peer, peer.screen);
  if (state.sharedScreenPeerId === peer.id) hideScreenStage();
  refreshScreenStage();
  updatePeerStatus(peer);
  refreshScreenAction(peer);
}

function attachRemoteAudioTrack(peer: Participant, track: MediaStreamTrack): void {
  if (peer.audioElements.has(track.id)) return;

  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.muted = isVoicePlaybackMuted();
  (audio as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
  audio.srcObject = new MediaStream([track]);
  peer.audioElements.set(track.id, audio);
  document.body.append(audio);
  applyAudioOutputDevice(audio).catch(() => {});
  playMediaElement(audio);

  track.addEventListener(
    'ended',
    () => {
      audio.remove();
      peer.audioElements.delete(track.id);
    },
    { once: true }
  );
}

export function detachRemoteAudioTrack(peer: Participant, trackId: string): void {
  const audio = peer.audioElements.get(trackId);
  if (!audio) return;

  audio.pause();
  audio.srcObject = null;
  audio.remove();
  peer.audioElements.delete(trackId);
}

export function removeAudioElements(peer: Participant): void {
  for (const audio of peer.audioElements.values()) {
    audio.remove();
  }
  peer.audioElements.clear();
}

export function setParticipantSpeaking(participant: Participant | null, speaking: boolean): void {
  const view = getParticipantView(participant);
  if (!view) return;
  view.node.dataset.speaking = String(Boolean(speaking));
}

function setParticipantScreenDataset(participant: Participant, screen: boolean): void {
  const view = getParticipantView(participant);
  if (!view) return;
  view.node.dataset.screen = String(screen);
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

  if (!peer.isLocal && peer.livekitParticipant && !hasConnectedLiveKitVoice(peer)) {
    setParticipantStatus(peer, 'подключает голос');
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

  setParticipantStatus(peer, 'подключает голос');
}

function hasConnectedLiveKitVoice(peer: Participant): boolean {
  if (!peer.livekitParticipant) return false;

  const publication = getLiveKitMicrophonePublication(peer);
  if (!publication) return false;
  return Boolean(publication.isMuted || publication.isSubscribed || publication.track || peer.audioElements.size > 0);
}

function getLiveKitMicrophonePublication(peer: Participant) {
  const publications = peer.livekitParticipant?.trackPublications;
  if (!publications) return null;

  return [...publications.values()].find(isMicrophonePublication) || null;
}

function setParticipantStatus(peer: Participant | ParticipantViewRefs, label: string): void {
  const view = 'status' in peer ? peer : getParticipantView(peer);
  if (!view) return;
  view.status.textContent = label;
  view.status.hidden = !label;
}

export function refreshParticipantState(): void {
  const participantCount = elements.participants.children.length;
  elements.participants.dataset.count = String(Math.min(participantCount, 8));
  elements.emptyRoom.hidden = participantCount > 0;
  refreshStageGridState();
}

export function refreshStageGridState(): void {
  if (!elements.tileGrid) return;

  const participantCount = elements.participants.children.length;
  const streamCount = getScreenParticipants().length;
  const totalCount = participantCount + streamCount;
  elements.tileGrid.dataset.count = String(Math.min(totalCount, 8));
  elements.tileGrid.dataset.streams = String(Math.min(streamCount, 8));
  elements.emptyRoom.hidden = totalCount > 0;
}

function applyParticipantPalette(node: HTMLElement, peerInfo: { avatarColorKey?: string; id?: string; name?: string }): void {
  const color = getAvatarColor(peerInfo.avatarColorKey);
  node.style.setProperty('--participant-pastel', color.background);
  node.style.setProperty('--participant-avatar-fg', color.foreground);
  node.style.setProperty('--participant-avatar-shadow', color.shadow);
}

export function getParticipantById(peerId: string): Participant | null {
  if (!peerId) return null;
  if (peerId === state.peerId) return state.self;
  return state.peers.get(peerId) || null;
}

export function getAllParticipants(): Participant[] {
  return [
    ...(state.self ? [state.self] : []),
    ...state.peers.values()
  ];
}
