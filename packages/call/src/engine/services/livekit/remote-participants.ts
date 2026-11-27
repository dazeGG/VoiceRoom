import { isCallPublicationAllowed } from '../../e2ee/call-room-e2ee';
import { getCallPorts, getInstalledCallPorts } from '../../ports';
// The other people in the call as LiveKit reports them: their participants,
// which of their tracks to subscribe to, and what to do as tracks come and go.
// Screens get a grace period through reconnects before they count as gone.

import { t } from '@voiceroom/ui-kit/i18n';
import { isLiveKitOnlyIdentity } from '@voiceroom/shared/validation';
import { markRaw } from 'vue';
import type { Room, RemoteParticipant, RemoteTrack, RemoteTrackPublication, TrackPublication } from 'livekit-client';
import { state } from '../../core/room-runtime.store';
import { clearPeerJoinCue } from '../../media/cues';
import { attachMeter } from '../../media/meters';
import { loadLiveKitClient } from '../../media/livekit-runtime';
import { getCameraReceiverDemand } from '../../media/camera-receiver-demand';
import { getScreenReceiverDemand } from '../../media/screen-receiver-demand';
import { useParticipantsUiStore } from '../../core/participants-ui.store';
import { useMobileCallUiStore } from '../../core/mobile-call-ui.store';
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
import { refreshScreenStage, refreshScreenTiles } from '../../ui/screen-view';
import type { Participant } from '../../core/types';
import { subscribeRoomRecoveryTransitions } from '../../recovery/room-recovery';
import { ScreenRecoveryGraceController } from '../../recovery/screen-recovery-grace';

import {
  isCameraPublication,
  isMicrophonePublication,
  isScreenAudioPublication,
  isScreenPublication,
  isScreenVideoPublication
} from './publication-kinds';
import { logLiveKitTransition } from './transport';
import { nativeReceiveRoute } from '../../core/native-receive-route';

const screenSubscriptionRetryController = createScreenSubscriptionRetryController();
const screenRecoveryGrace = new ScreenRecoveryGraceController();
const nativePausedMicrophones = new WeakSet<RemoteTrackPublication>();

subscribeRoomRecoveryTransitions((event) => {
  const { epoch, phase } = event;
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
  nativeReceiveRoute.settingsChanged?.();
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

export function createLiveKitParticipant(participant: RemoteParticipant): Participant | null {
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
    name: liveKitParticipantName(participant),
    screen: participant.isScreenShareEnabled || screenPresence.active,
    screenAudio: screenPresence.hasAudio
  });
  peer.livekitParticipant = markRaw(participant);
  peer.voiceIssue = '';
  updatePeerStatus(peer);
  return peer;
}

function isServerKnownRemotePeer(peerId: string): boolean {
  if (isLiveKitOnlyIdentity(peerId)) return false;
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

export function updateLiveKitPublicationState(peer: Participant, publication: RemoteTrackPublication): void {
  if (isScreenVideoPublication(publication)) {
    if (peer.screenAuthoritative === false) return;
    screenRecoveryGrace.cancel(peer.id);
    const hadScreen = peer.screen;
    peer.screen = true;
    applyRemoteScreenCue(peer, hadScreen, true);
    updatePeerStatus(peer);
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
  if (isCameraPublication(publication)) {
    peer.camera = true;
  }
}

/**
 * The name a LiveKit participant shows under. The personal SFU gets only the opaque identity, so the guest name
 * comes from presence. A call takes only the roster name: its E2EE token lets a participant rename itself in LiveKit.
 */
export function liveKitParticipantName(participant: { identity: string; name?: string | undefined }): string {
  const rosterName = state.peers.get(participant.identity)?.name;
  if (state.callId) return rosterName || participant.identity;
  return participant.name || rosterName || participant.identity;
}

export function syncLiveKitPublicationSubscription(peer: Participant, publication: RemoteTrackPublication): void {
  if (typeof publication.setSubscribed !== 'function') return;

  if (isMicrophonePublication(publication)) {
    const native = nativeReceiveRoute.active;
    setRemotePublicationSubscribed(publication, native || !state.outputMuted);
    // LiveKit scopes speaker updates to subscribers. Disable RTP forwarding
    // while preserving the subscription that carries the speaker signaling.
    if (native) {
      nativePausedMicrophones.add(publication);
      publication.setEnabled(false);
    } else if (!state.outputMuted && nativePausedMicrophones.delete(publication)) {
      publication.setEnabled(true);
    }
    return;
  }

  if (isCameraPublication(publication)) {
    const subscribed = getInstalledCallPorts()?.mediaPolicy.camera !== false;
    setRemotePublicationSubscribed(publication, subscribed);
    if (!subscribed) return;
    applyRemoteVideoVisibility(publication);
    void applyRemoteCameraDemand(peer, publication);
    return;
  }

  if (isScreenPublication(publication)) {
    const subscribed = shouldSubscribeToScreen(peer);
    if (!subscribed) clearScreenSubscriptionRetry(publication);
    setRemotePublicationSubscribed(publication, subscribed);
    if (subscribed && isScreenVideoPublication(publication)) {
      applyRemoteVideoVisibility(publication);
      void applyRemoteScreenVideoDemand(peer, publication);
    }
    if (subscribed) {
      const attached = attachSubscribedRemoteScreenTrack(peer, publication);
      if (!attached && publication.isSubscribed && publication.track) {
        void scheduleScreenSubscriptionRetry(peer, publication);
      }
    }
  }
}

function attachSubscribedRemoteScreenTrack(peer: Participant, publication: RemoteTrackPublication): boolean {
  if (!isScreenPublication(publication) || publication.isSubscribed === false) return false;

  const track = publication.track;
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

async function applyRemoteCameraDemand(peer: Participant, publication: RemoteTrackPublication): Promise<boolean> {
  if (getInstalledCallPorts()?.mediaPolicy.camera === false) return false;
  const { VideoQuality } = await loadLiveKitClient();
  if (publication.isDesired === false) return false;
  if (peer.livekitParticipant?.trackPublications.get(publication.trackSid) !== publication) return false;
  const demand = getCameraReceiverDemand(peer.id, {
    // A phone draws its own layout; the desktop spotlight under it may be stale.
    focusedPeerId: useMobileCallUiStore().isMobileCallActive()
      ? useMobileCallUiStore().getMobileSpotlightPeerId()
      : useParticipantsUiStore().focusedParticipantId,
    participantCount: state.peers.size + (state.self ? 1 : 0),
    screenOnStage: Boolean(state.viewedScreenPeerId)
  });
  // An overloaded computer decodes the smallest layer of every camera it does not show large.
  const shown = state.videoRelieved && demand !== 'high' ? 'low' : demand;
  publication.setVideoQuality(
    shown === 'high' ? VideoQuality.HIGH : shown === 'medium' ? VideoQuality.MEDIUM : VideoQuality.LOW
  );
  return shown !== demand;
}

/**
 * Remote video (cameras and screens) is received only while someone can see
 * the app: in the tray, minimized or in a background tab the SFU stops sending
 * it. The subscription stays, so the picture is back with the next keyframe as
 * soon as the app is shown, and screen audio and voices keep playing.
 */
function applyRemoteVideoVisibility(publication: RemoteTrackPublication): void {
  if (!isCameraPublication(publication) && !isScreenVideoPublication(publication)) return;
  if (isCameraPublication(publication) && getInstalledCallPorts()?.mediaPolicy.camera === false) return;
  // setEnabled only works on a publication we subscribe to.
  if (typeof publication.setEnabled !== 'function' || publication.isDesired === false) return;
  const visible = getCallPorts().platform.isVisible();
  if (publication.isEnabled === visible) return;
  publication.setEnabled(visible);
}

export function syncRemoteVideoVisibility(): void {
  for (const peer of state.peers.values()) {
    peer.livekitParticipant?.trackPublications.forEach(applyRemoteVideoVisibility);
  }
}

/** Re-picks every camera layer after the layout changed (focus, a screen, a join). */
export async function syncRemoteCameraDemand(): Promise<boolean> {
  const updates: Array<Promise<boolean>> = [];
  for (const peer of state.peers.values()) {
    peer.livekitParticipant?.trackPublications.forEach((publication) => {
      if (isCameraPublication(publication)) updates.push(applyRemoteCameraDemand(peer, publication));
    });
  }
  return (await Promise.all(updates)).some(Boolean);
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
  if (publication && isScreenPublication(publication)) {
    void scheduleScreenSubscriptionRetry(peer, publication, error);
    return;
  }
  if (!isMicrophonePublication(publication)) return;

  peer.voiceIssue = t('голос не подключен');
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
      if (!isCallPublicationAllowed(publication)) return;
      publication.setSubscribed(false);
      publication.setSubscribed(true);
      applyRemoteVideoVisibility(publication);
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
      const restoreMeter = nativePausedMicrophones.has(publication);
      syncLiveKitPublicationSubscription(peer, publication);
      ensureRemoteMicrophonePlayback(peer, publication, restoreMeter);
    });
  });
}

function setRemotePublicationSubscribed(publication: RemoteTrackPublication, wanted: boolean): void {
  // An E2EE call takes only encrypted media: a cleartext publication there can only be the server's.
  const subscribed = wanted && isCallPublicationAllowed(publication);
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

function ensureRemoteMicrophonePlayback(
  peer: Participant,
  publication: RemoteTrackPublication,
  restoreMeter: boolean
): void {
  if (!isMicrophonePublication(publication)) return;
  if (state.outputMuted || nativeReceiveRoute.active) return;

  const track = publication.track;
  const mediaTrack = track?.mediaStreamTrack;
  if (!mediaTrack || mediaTrack.kind !== 'audio' || mediaTrack.readyState === 'ended') return;
  if (publication.isSubscribed === false) return;

  peer.voiceIssue = '';
  const stream = track.mediaStream || new MediaStream([mediaTrack]);
  peer.stream = markRaw(stream);
  peer.micReceiver = track.receiver ? markRaw(track.receiver) : peer.micReceiver;
  ensureRemoteAudioElement(peer, mediaTrack, track.receiver);
  if (restoreMeter && peer.meter?.track !== mediaTrack) attachMeter(peer, new MediaStream([mediaTrack]));
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

  if (isCameraPublication(publication)) {
    if (getInstalledCallPorts()?.mediaPolicy.camera === false) {
      setRemotePublicationSubscribed(publication, false);
      peer.cameraStream = null;
      return;
    }
    peer.camera = true;
    peer.cameraStream = mediaTrack.readyState === 'ended' ? null : markRaw(new MediaStream([mediaTrack]));
    applyRemoteVideoVisibility(publication);
    void applyRemoteCameraDemand(peer, publication);
    return;
  }

  const stream = track.mediaStream || new MediaStream([mediaTrack]);
  if (isScreenVideoPublication(publication)) {
    screenRecoveryGrace.cancel(peer.id);
    applyRemoteVideoVisibility(publication);
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
    if (nativeReceiveRoute.active) return;
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

  if (isCameraPublication(publication)) {
    if (peer.cameraStream?.getVideoTracks()[0] === track.mediaStreamTrack) peer.cameraStream = null;
    return;
  }

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

  if (isCameraPublication(publication)) {
    peer.camera = false;
    peer.cameraStream = null;
    return;
  }

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
