// The other people in the call as LiveKit reports them: their participants,
// which of their tracks to subscribe to, and what to do as tracks come and go.
// Screens get a grace period through reconnects before they count as gone.

import type {
  Participant as LiveKitParticipant,
  Room,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  TrackPublication
} from 'livekit-client';
import { state } from '../../core/state.svelte';
import { clearPeerJoinCue } from '../../media/cues';
import { loadLiveKitClient } from '../../media/livekit-runtime';
import { getScreenReceiverDemand } from '../../media/screen-receiver-demand';
import { getScreenPublicationPresence } from '../../media/screen-publication-state';
import { createScreenSubscriptionRetryController } from '../../media/screen-subscription-retry';
import {
  applyRemoteScreenCue,
  attachRemoteScreenStream,
  attachRemoteTrack,
  createParticipant,
  ensureRemoteAudioElement,
  detachRemoteAudioTrack,
  detachRemoteScreen,
  detachRemoteScreenAudioTrack,
  detachRemoteScreenVideoTrack,
  detachRemoteScreenVideoTracks,
  removePeer,
  updatePeerStatus
} from '../../room/participants';
import { refreshScreenAction, refreshScreenStage, refreshScreenTiles } from '../../ui/screen-view';
import type { Participant } from '../../core/types';
import { subscribeRoomRecoveryTransitions } from '../../recovery/room-recovery';
import { ScreenRecoveryGraceController } from '../../recovery/screen-recovery-grace';

import {
  isMicrophonePublication,
  isScreenAudioPublication,
  isScreenPublication,
  isScreenVideoPublication
} from './publication-kinds';
import { logLiveKitTransition } from './transport';

const screenSubscriptionRetryController = createScreenSubscriptionRetryController();
const screenRecoveryGrace = new ScreenRecoveryGraceController();

subscribeRoomRecoveryTransitions((event) => {
  const phase = typeof event.phase === 'string' ? event.phase : '';
  const epoch = Number(event.epoch || 0);
  if (phase === 'recovering' || phase === 'waiting-app-snapshot' || phase === 'waiting-livekit') {
    screenRecoveryGrace.beginGlobal(epoch);
  } else if (phase === 'healthy') {
    screenRecoveryGrace.endGlobal(false);
  } else if (phase === 'failed' || phase === 'cancelled') {
    screenRecoveryGrace.endGlobal(true);
  }
});

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

export function createLiveKitParticipant(participant: LiveKitParticipant): Participant | null {
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

export function updateLiveKitPublicationState(peer: Participant, publication: TrackPublication): void {
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

export function syncLiveKitPublicationSubscription(peer: Participant, publication: TrackPublication): void {
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

function attachSubscribedRemoteScreenTrack(peer: Participant, publication: RemoteTrackPublication): boolean {
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

async function applyRemoteScreenVideoDemand(peer: Participant, publication: RemoteTrackPublication): Promise<void> {
  if (!isScreenVideoPublication(publication)) return;
  if (!shouldSubscribeToScreen(peer)) return;

  const { VideoQuality } = await loadLiveKitClient();
  if (!shouldSubscribeToScreen(peer) || publication.isDesired === false) return;
  if (peer.livekitParticipant?.trackPublications.get(publication.trackSid) !== publication) return;

  const quality = getRemoteScreenDemand(peer) === 'stage' ? VideoQuality.HIGH : VideoQuality.LOW;
  publication.setVideoQuality(quality);
}

export function handleLiveKitTrackSubscriptionFailed(
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

export function clearAllScreenSubscriptionRetries(): void {
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

export function retryDemandedScreenSubscriptions(room: Room): void {
  room.remoteParticipants.forEach((participant) => {
    const peer = state.peers.get(participant.identity);
    if (!peer) return;

    participant.trackPublications.forEach((publication) => {
      if (!isScreenPublication(publication) || !shouldSubscribeToScreen(peer)) return;
      if (attachSubscribedRemoteScreenTrack(peer, publication)) return;
      void scheduleScreenSubscriptionRetry(peer, publication);
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

export function handleLiveKitTrackSubscribed(
  track: RemoteTrack,
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
): void {
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

export function handleLiveKitTrackUnsubscribed(
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

export function handleLiveKitTrackUnpublished(
  publication: RemoteTrackPublication,
  participant: RemoteParticipant
): void {
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
