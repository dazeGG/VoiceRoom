import { usePageStore } from '@/stores/page.store';
import { showToast } from './toast';
import { state } from '../core/room-runtime.store';
import { postState } from '../room/presence';
import { clearScreenAttendance, setScreenAttendance } from '../model/screen-attendance';

import { useScreenUiStore } from '../../screen-ui.store';
import { useParticipantsUiStore } from '../../participants-ui.store';
import { detachRemoteScreen, getAllParticipants, getParticipantById, hasRemoteScreenVideo } from '../room/participants';
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

function syncLiveKitScreenSubscriptionsSoon(peer: Participant): void {
  void import('../services/livekit-service').then((module) => module.syncLiveKitScreenSubscriptions(peer));
}

export function handleScreenStageClick(event: Event): void {
  if (!state.viewedScreenPeerId || !useScreenUiStore().stageVisible) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (
    target.closest('.screen-view-controls') ||
    target.closest('.screen-meta') ||
    target.closest('.screen-placeholder')
  ) {
    return;
  }

  leaveScreenView({ keepPreview: true }).catch((error: unknown) =>
    log.error('screen view action failed', errorContext(error))
  );
}

export function openLocalStreamPreview(): void {
  const peerId = state.peerId;
  if (!peerId || !state.localScreenStream) return;

  if (state.viewedScreenPeerId === peerId) {
    void leaveScreenView({ keepPreview: true });
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
    refreshScreenTiles();
    return;
  }

  if (state.viewedScreenPeerId === peerId) return;
  if (state.viewedScreenPeerId) {
    await leaveScreenView({ keepPreview: true });
  }

  // The screen spotlight replaces a focused participant tile: both render into
  // the same stage slot, so they must never be active at the same time.
  useParticipantsUiStore().clearParticipantFocus();
  setViewedScreenPeerId(peerId);
  state.screenCollapsedPeerIds.delete(peerId);
  state.screenSubscribedPeerIds.add(peerId);
  if (!peer.isLocal) setScreenAttendance(state.self, peerId);
  state.screenRequesting = !peer.isLocal && !hasRemoteScreenVideo(peer);
  refreshScreenTiles();
  refreshScreenStage();

  if (!peer.isLocal) syncLiveKitScreenSubscriptionsSoon(peer);
  if (peer.isLocal || hasRemoteScreenVideo(peer)) {
    state.screenRequesting = false;
    refreshScreenStage();
  }
  postState().catch(() => {});
}

export async function leaveScreenView(options: { keepPreview?: boolean } = {}): Promise<void> {
  const { keepPreview = false } = options;
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
  refreshScreenTiles();
  postState().catch(() => {});
}

export function disconnectScreen(peerId: string): void {
  state.screenCollapsedPeerIds.delete(peerId);
  state.screenSubscribedPeerIds.delete(peerId);
  clearScreenAttendance(state.self, peerId);

  if (state.viewedScreenPeerId === peerId) {
    void leaveScreenView({ keepPreview: false });
    return;
  }

  const peer = getParticipantById(peerId);
  if (peer && !peer.isLocal) {
    detachRemoteScreen(peer);
    syncLiveKitScreenSubscriptionsSoon(peer);
  }

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

  refreshScreenTiles();
  if (attendanceCleared) postState().catch(() => {});
  return peerId;
}

export function isScreenSubscribed(peerId: string): boolean {
  if (!peerId) return false;
  if (state.viewedScreenPeerId === peerId) return true;
  return state.screenSubscribedPeerIds.has(peerId);
}

function isParticipantStreaming(participant: Participant | null): boolean {
  if (!participant) return false;
  if (participant.screen) return true;
  return participant.isLocal && Boolean(state.localScreenStream);
}

export function refreshScreenStage(): void {
  const peer = useScreenUiStore().getActiveScreenPeer();
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
  usePageStore().screenView = true;
  useScreenUiStore().stageVisible = true;
  useScreenUiStore().activeStream = stream;
  useScreenUiStore().hideLeaveButton = true;
  useScreenUiStore().showScreenExit = true;
  refreshScreenStreamControls(peer);
  refreshScreenMeta(peer);
  syncScreenStagePointerState();

  const video = useScreenUiStore().getScreenVideo();
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
  useScreenUiStore().bumpScreenUiRevision();
}

export function hideScreenStage(): void {
  state.sharedScreenPeerId = '';
  usePageStore().screenView = false;
  stopScreenStageIdleUi();
  useScreenUiStore().stageVisible = false;
  useScreenUiStore().showMeta = false;
  useScreenUiStore().activeStream = null;
  useScreenUiStore().hideLeaveButton = false;
  useScreenUiStore().showScreenExit = false;
  stopScreenAudioFallback();

  const video = useScreenUiStore().getScreenVideo();
  const stage = getScreenStage();
  video?.pause();
  if (video) {
    releaseScreenMediaElement(video);
    video.srcObject = null;
  }
  if (stage && document.fullscreenElement === stage) {
    document.exitFullscreen().catch(() => {});
  }
  if (usePageStore().desktopScreenFullscreen) {
    setDesktopScreenFullscreen(false).catch((error: unknown) =>
      log.error('screen view action failed', errorContext(error))
    );
  }
  refreshScreenTiles();
  refreshStageStripControls();
  useScreenUiStore().bumpScreenUiRevision();
}

function getScreenStage() {
  return document.getElementById('screenStage');
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
  useScreenUiStore().bumpScreenUiRevision();
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

import { createLogger, errorContext } from '@/shared/log';

const log = createLogger('room:screen-view');
