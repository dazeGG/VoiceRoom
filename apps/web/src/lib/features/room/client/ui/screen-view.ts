import { showToast } from './toast';
import { state } from '../core/state.svelte';
import { postState } from '../room/presence';
import { syncLiveKitScreenSubscriptions } from '../services/livekit-service';

import { bumpScreenUiRevision, screenUi } from '../../screen-ui.svelte';
import {
  detachRemoteScreen,
  getAllParticipants,
  getParticipantById
} from '../room/participants';
import type { Participant } from '../core/types';
import { playMediaElement } from '../services/media-playback-service';
import {
  refreshScreenMeta,
  refreshScreenStreamControls,
  refreshStageStripControls,
  setDesktopScreenFullscreen,
  stopScreenStageIdleUi,
  syncScreenStagePointerState,
  syncScreenVideoAudio
} from './screen-stage-controls';
import { getScreenVideo } from '../../screen-ui.svelte';

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

  setViewedScreenPeerId(peerId);
  state.screenCollapsedPeerIds.delete(peerId);
  state.screenSubscribedPeerIds.add(peerId);
  state.screenRequesting = !peer.isLocal && !peer.screenStream;
  refreshAllScreenActions();
  refreshScreenTiles();
  refreshScreenStage();

  if (!peer.isLocal) syncLiveKitScreenSubscriptions(peer);
  if (peer.isLocal || peer.screenStream) {
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
    if (peer && !peer.isLocal) detachRemoteScreen(peer);
  }

  if (peer && !peer.isLocal) syncLiveKitScreenSubscriptions(peer);
  if (!quiet) refreshAllScreenActions();
  refreshScreenTiles();
  postState().catch(() => {});
}

export function disconnectScreen(peerId: string): void {
  state.screenCollapsedPeerIds.delete(peerId);
  state.screenSubscribedPeerIds.delete(peerId);

  if (state.viewedScreenPeerId === peerId) {
    void leaveScreenView({ quiet: true, keepPreview: false });
    return;
  }

  const peer = getParticipantById(peerId);
  if (peer && !peer.isLocal) {
    detachRemoteScreen(peer);
    syncLiveKitScreenSubscriptions(peer);
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
  hideScreenStage();

  const peer = getParticipantById(peerId);
  if (peer && !peer.isLocal) {
    detachRemoteScreen(peer);
    syncLiveKitScreenSubscriptions(peer);
  }

  refreshAllScreenActions();
  refreshScreenTiles();
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
  state.sharedScreenPeerId = stream ? peer.id : '';
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

  const video = getScreenVideo();
  const stage = getScreenStage();
  video?.pause();
  if (video) video.srcObject = null;
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
  return participant.isLocal ? state.localScreenStream : participant.screenStream;
}

function setViewedScreenPeerId(peerId: string): void {
  state.viewedScreenPeerId = peerId || '';
  if (state.self) state.self.viewedScreenPeerId = state.viewedScreenPeerId;
}

export function refreshScreenTiles(): void {
  const screenParticipants = getScreenParticipants()
    .filter((participant) => participant.id !== state.viewedScreenPeerId);
  screenUi.streamTilesVisible = screenParticipants.length > 0;
  screenUi.streamTilesCount = Math.min(screenParticipants.length, 8);
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