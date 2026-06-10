import { elements } from '../ui/dom';
import { state } from '../core/state';
import { getScreenProfile } from '../media/profiles';
import { getInitials, hashStringToHue } from '../core/utils';
import {
  applyAudioOutputDevice,
  isVoicePlaybackMuted,
  playMediaElement
} from '../media/playback';
import { clearPeerJoinCue, playStreamCue } from '../media/cues';
import { attachMeter } from '../media/meters';
import { isMicrophonePublication, syncLiveKitScreenSubscriptions } from './livekit';
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
import type { Participant, PeerInfo } from '../core/types';

const watchedRemoteScreenTracks = new WeakSet<MediaStreamTrack>();

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
      duplicate?.node.remove();
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
  setParticipantStatus({ status }, isLocal ? '' : 'подключает голос');
  node.dataset.deafened = String(Boolean(peerInfo.deafened));
  node.dataset.muted = String(Boolean(peerInfo.muted));
  node.dataset.screen = String(Boolean(peerInfo.screen));
  applyParticipantPalette(node, peerInfo);

  elements.participants.append(node);

  const participant: Participant = {
    analyser: null,
    audioElements: new Map(),
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
    node,
    micReceiver: null,
    screen: Boolean(peerInfo.screen),
    screenAction,
    screenAudio: Boolean(peerInfo.screenAudio),
    screenProfileId: getScreenProfile(peerInfo.screenProfileId ?? '').id,
    screenStream: null,
    screenStreamId: peerInfo.screenStreamId || '',
    status,
    stream: null,
    viewedScreenPeerId: peerInfo.viewedScreenPeerId || '',
    voiceIssue: ''
  };

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
  return participant;
}

export function updateParticipant(peerInfo: PeerInfo): void {
  const participant = peerInfo.id === state.peerId ? state.self : state.peers.get(peerInfo.id);
  if (!participant) return;

  const hadScreen = participant.screen;
  const hasScreenUpdate = Object.hasOwn(peerInfo, 'screen');
  if (Object.hasOwn(peerInfo, 'name')) participant.name = peerInfo.name || participant.name;
  if (Object.hasOwn(peerInfo, 'deafened')) participant.deafened = Boolean(peerInfo.deafened);
  if (Object.hasOwn(peerInfo, 'muted')) participant.muted = Boolean(peerInfo.muted);
  if (hasScreenUpdate) participant.screen = Boolean(peerInfo.screen);
  if (Object.hasOwn(peerInfo, 'screenAudio')) participant.screenAudio = Boolean(peerInfo.screenAudio);
  if (Object.hasOwn(peerInfo, 'screenProfileId')) participant.screenProfileId = getScreenProfile(peerInfo.screenProfileId ?? '').id;
  if (Object.hasOwn(peerInfo, 'screenStreamId')) participant.screenStreamId = peerInfo.screenStreamId || '';
  if (Object.hasOwn(peerInfo, 'viewedScreenPeerId')) participant.viewedScreenPeerId = peerInfo.viewedScreenPeerId || '';
  participant.node.dataset.deafened = String(participant.deafened);
  participant.node.dataset.muted = String(participant.muted);
  participant.node.dataset.screen = String(participant.screen);
  applyParticipantPalette(participant.node, participant);
  participant.node.querySelector('.avatar')!.textContent = getInitials(participant.name);
  participant.node.querySelector('.participant-name')!.textContent = participant.isLocal ? `${participant.name} · вы` : participant.name;
  if (Object.hasOwn(peerInfo, 'muted') && participant.muted) {
    participant.incomingVoiceActive = false;
    setParticipantSpeaking(participant, false);
  }
  if (hasScreenUpdate && !participant.isLocal && hadScreen !== participant.screen) {
    playStreamCue(participant.screen ? 'start' : 'stop');
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
  refreshScreenTiles();
  refreshScreenStage();
}

export function removePeer(peerId: string): void {
  const peer = state.peers.get(peerId);
  if (!peer) return;

  clearPeerJoinCue(peerId);
  removeAudioElements(peer);
  state.screenCollapsedPeerIds.delete(peerId);
  state.screenSubscribedPeerIds.delete(peerId);
  if (state.viewedScreenPeerId === peer.id) {
    closeScreenView();
  }
  if (state.sharedScreenPeerId === peer.id) {
    hideScreenStage();
  }
  peer.node.remove();
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
  peer.node.dataset.screen = 'true';

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
  peer.node.dataset.screen = String(peer.screen);
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
  if (!participant?.node) return;
  participant.node.dataset.speaking = String(Boolean(speaking));
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

function setParticipantStatus(peer: Pick<Participant, 'status'>, label: string): void {
  peer.status.textContent = label;
  peer.status.hidden = !label;
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

function applyParticipantPalette(node: HTMLElement, peerInfo: { id?: string; name?: string }): void {
  const seed = `${peerInfo.id || ''}:${peerInfo.name || ''}`;
  const hue = hashStringToHue(seed);
  node.style.setProperty('--participant-pastel', `oklch(84% 0.075 ${hue})`);
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
