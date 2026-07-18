import { showToast } from './toast';
import { state } from '../core/state.svelte';
import { postState } from '../room/presence';
import { clearScreenAttendance, setScreenAttendance } from '../model/screen-attendance';

import { bumpScreenUiRevision, screenUi } from '../../screen-ui.svelte';
import { clearParticipantFocus } from '../../participants-ui.svelte';
import {
  detachRemoteScreen,
  getAllParticipants,
  getParticipantById,
  hasRemoteScreenVideo
} from '../room/participants';
import type { Participant } from '../core/types';
import { playMediaElement, releaseScreenMediaElement } from '../services/media-playback-service';
import {
  refreshScreenMeta,
  refreshScreenStreamControls,
  refreshStageStripControls,
  setDesktopScreenFullscreen,
  stopScreenStageIdleUi,
  stopScreenAudioFallback,
  syncScreenAudioFallback,
  syncScreenStagePointerState,
  syncScreenVideoAudio
} from './screen-stage-controls';
import { getScreenVideo } from '../../screen-ui.svelte';

function syncLiveKitScreenSubscriptionsSoon(peer: Participant): void {
  void import('../services/livekit-service').then((module) => module.syncLiveKitScreenSubscriptions(peer));
}

export function handleScreenStageClick(event: MouseEvent): void {
  if (!state.viewedScreenPeerId || !screenUi.stageVisible) return;
  const target = event.target as Element;
  if (
    target.closest('.screen-view-controls')
    || target.closest('.screen-meta')
    || target.closest('.screen-placeholder')
  ) {
    return;
  }

  leaveScreenView({ keepPreview: true }).catch((error) => console.error(error));
}

export function openLocalStreamPreview(): void {
  const peerId = state.peerId;
  if (!peerId || !state.localScreenStream) return;

  if (state.viewedScreenPeerId === peerId) {
    void leaveScreenView({ quiet: true, keepPreview: true });
    return;
  }

  state.screenSubscribedPeerIds.add(peerId);
  state.screenCollapsedPeerIds.add(peerId);
  refreshScreenTiles();
  refreshScreenStage();
}

export async function enterScreenView(peerId: string): Promise<void> {
  const peer = getParticipantById(peerId);
  if (peer?.isLocal && state.localScreenStream) {
    peer.screen = true;

  }
  if (!peer?.screen) {
    showToast('Демонстрация уже завершена');
    refreshAllScreenActions();
    refreshScreenTiles();
    return;
  }

  if (state.viewedScreenPeerId === peerId) return;
  if (state.viewedScreenPeerId) {
    await leaveScreenView({ quiet: true, keepPreview: true });
  }

  // The screen spotlight replaces a focused participant tile: both render into
  // the same stage slot, so they must never be active at the same time.
  clearParticipantFocus();
  setViewedScreenPeerId(peerId);
  state.screenCollapsedPeerIds.delete(peerId);
  state.screenSubscribedPeerIds.add(peerId);
  if (!peer.isLocal) setScreenAttendance(state.self, peerId);
  state.screenRequesting = !peer.isLocal && !hasRemoteScreenVideo(peer);
  refreshAllScreenActions();
  refreshScreenTiles();
  refreshScreenStage();

  if (!peer.isLocal) syncLiveKitScreenSubscriptionsSoon(peer);
  if (peer.isLocal || hasRemoteScreenVideo(peer)) {
    state.screenRequesting = false;
    refreshScreenStage();
  }
  postState().catch(() => {});
}

export async function leaveScreenView(options: { quiet?: boolean; keepPreview?: boolean } = {}): Promise<void> {
  const { quiet = false, keepPreview = false } = options;
  const peerId = state.viewedScreenPeerId;
  if (!peerId) return;

  setViewedScreenPeerId('');
  state.screenRequesting = false;
  state.stripCollapsed = false;
  hideScreenStage();

  const peer = getParticipantById(peerId);
  if (keepPreview) {
    state.screenSubscribedPeerIds.add(peerId);
    state.screenCollapsedPeerIds.add(peerId);
  } else {
    state.screenCollapsedPeerIds.delete(peerId);
    state.screenSubscribedPeerIds.delete(peerId);
    clearScreenAttendance(state.self, peerId);
    if (peer && !peer.isLocal) detachRemoteScreen(peer);
  }

  if (peer && !peer.isLocal) syncLiveKitScreenSubscriptionsSoon(peer);
  if (!quiet) refreshAllScreenActions();
  refreshScreenTiles();
  postState().catch(() => {});
}

export function disconnectScreen(peerId: string): void {
  state.screenCollapsedPeerIds.delete(peerId);
  state.screenSubscribedPeerIds.delete(peerId);
  clearScreenAttendance(state.self, peerId);

  if (state.viewedScreenPeerId === peerId) {
    void leaveScreenView({ quiet: true, keepPreview: false });
    return;
  }

  const peer = getParticipantById(peerId);
  if (peer && !peer.isLocal) {
    detachRemoteScreen(peer);
    syncLiveKitScreenSubscriptionsSoon(peer);
  }

  refreshAllScreenActions();
  refreshScreenTiles();
  postState().catch(() => {});
}

export function closeScreenView(): string {
  const peerId = state.viewedScreenPeerId;
  if (!peerId) return '';

  setViewedScreenPeerId('');
  state.screenRequesting = false;
  state.stripCollapsed = false;
  state.screenCollapsedPeerIds.delete(peerId);
  state.screenSubscribedPeerIds.delete(peerId);
  const attendanceCleared = clearScreenAttendance(state.self, peerId);
  hideScreenStage();

  const peer = getParticipantById(peerId);
  if (peer && !peer.isLocal) {
    detachRemoteScreen(peer);
    syncLiveKitScreenSubscriptionsSoon(peer);
  }

  refreshAllScreenActions();
  refreshScreenTiles();
  if (attendanceCleared) postState().catch(() => {});
  return peerId;
}

export function isScreenSubscribed(peerId: string): boolean {
  if (!peerId) return false;
  if (state.viewedScreenPeerId === peerId) return true;
  return state.screenSubscribedPeerIds.has(peerId);
}

export function refreshScreenAction(_participant: Participant | null): void {}

export function refreshAllScreenActions(): void {

}

function isParticipantStreaming(participant: Participant | null): boolean {
  if (!participant) return false;
  if (participant.screen) return true;
  return participant.isLocal && Boolean(state.localScreenStream);
}

export function refreshScreenStage(): void {
  const peer = getActiveScreenPeer();
  if (!isParticipantStreaming(peer)) {
    if (state.viewedScreenPeerId) closeScreenView();
    else hideScreenStage();
    return;
  }
  if (!peer) return;

  showScreenStage({
    peer,
    stream: getScreenStreamForParticipant(peer)
  });
}

function showScreenStage({ peer, stream }: { peer: Participant; stream: MediaStream | null }): void {
  state.sharedScreenPeerId = peer.id;
  document.body.dataset.screenView = 'true';
  screenUi.stageVisible = true;
  screenUi.hasStream = Boolean(stream);
  screenUi.showControls = Boolean(stream);
  screenUi.showPlaceholder = !stream;
  screenUi.activeStream = stream;
  screenUi.hideLeaveButton = true;
  screenUi.showScreenExit = true;
  refreshScreenStreamControls(peer);
  refreshScreenMeta(peer);
  syncScreenStagePointerState();

  const video = getScreenVideo();
  if (!stream && video) {
    video.pause();
    releaseScreenMediaElement(video);
    video.srcObject = null;
  }
  syncScreenAudioFallback(peer, Boolean(stream));
  if (stream && video) {
    syncScreenVideoAudio();
    playMediaElement(video);
  }
  refreshScreenTiles();
  refreshStageStripControls();
  bumpScreenUiRevision();
}

export function hideScreenStage(): void {
  state.sharedScreenPeerId = '';
  delete document.body.dataset.screenView;
  stopScreenStageIdleUi();
  screenUi.stageVisible = false;
  screenUi.showControls = false;
  screenUi.showMeta = false;
  screenUi.showPlaceholder = true;
  screenUi.activeStream = null;
  screenUi.hideLeaveButton = false;
  screenUi.showScreenExit = false;
  stopScreenAudioFallback();

  const video = getScreenVideo();
  const stage = getScreenStage();
  video?.pause();
  if (video) {
    releaseScreenMediaElement(video);
    video.srcObject = null;
  }
  if (stage && document.fullscreenElement === stage) {
    document.exitFullscreen().catch(() => {});
  }
  if (document.body.dataset.desktopScreenFullscreen === 'true') {
    setDesktopScreenFullscreen(false).catch((error) => console.error(error));
  }
  refreshScreenTiles();
  refreshStageStripControls();
  bumpScreenUiRevision();
}

function getScreenStage() {
  return document.getElementById('screenStage');
}

export function getActiveScreenPeer(): Participant | null {
  return getParticipantById(state.viewedScreenPeerId);
}

export function getScreenParticipants(): Participant[] {
  return getAllParticipants()
    .filter((participant) => participant.screen)
    .sort((first, second) => {
      if (first.id === state.viewedScreenPeerId) return -1;
      if (second.id === state.viewedScreenPeerId) return 1;
      return first.joinedAt - second.joinedAt;
    });
}

export function getScreenStreamForParticipant(participant: Participant | null): MediaStream | null {
  if (!participant?.screen) return null;
  if (participant.isLocal) return state.localScreenStream;
  return hasRemoteScreenVideo(participant) ? participant.screenStream : null;
}

function setViewedScreenPeerId(peerId: string): void {
  state.viewedScreenPeerId = peerId || '';
}

export function refreshScreenTiles(): void {
  refreshStageStripControls();
  bumpScreenUiRevision();
}

export function hasStreamTilePreview(participant: Participant): boolean {
  return isScreenSubscribed(participant.id) && Boolean(getScreenStreamForParticipant(participant));
}

export function isStreamTileCollapsed(participant: Participant): boolean {
  return state.screenCollapsedPeerIds.has(participant.id) && hasStreamTilePreview(participant);
}

export {
  bindScreenStageIdleUi,
  refreshScreenMeta,
  refreshStageStripControls,
  syncScreenVideoAudio,
  toggleScreenFullscreen,
  toggleScreenMute,
  updateScreenFullscreenState,
  updateScreenVolumeFromSlider
} from './screen-stage-controls';
