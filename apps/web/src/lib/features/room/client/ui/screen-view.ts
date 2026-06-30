import { elements } from './dom';
import { mountIcons } from './icons';
import { showToast } from './toast';
import { state } from '../core/state.svelte';
import { postState } from '../room/presence';
import { syncLiveKitScreenSubscriptions } from '../services/livekit-service';
import { bumpParticipantsRevision } from '../../participants-ui.svelte';
import {
  detachRemoteScreen,
  getAllParticipants,
  getParticipantById
} from '../room/participants';
import type { Participant } from '../core/types';
import { createStreamTile } from './screen-tile-elements';
import { playMediaElement } from '../services/media-playback-service';
import {
  configureScreenStageControls,
  refreshScreenMeta,
  refreshScreenStreamControls,
  refreshStageStripControls,
  setDesktopScreenFullscreen,
  stopScreenStageIdleUi,
  syncScreenStagePointerState,
  syncScreenVideoAudio
} from './screen-stage-controls';

configureScreenStageControls({ getActiveScreenPeer });

export function handleScreenStageClick(event: MouseEvent): void {
  if (!state.viewedScreenPeerId || elements.screenStage.hidden) return;
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
    bumpParticipantsRevision();
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

/** Screen action button state is derived in ParticipantTile.svelte. */
export function refreshScreenAction(_participant: Participant | null): void {}

export function refreshAllScreenActions(): void {
  bumpParticipantsRevision();
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
  elements.screenStage.hidden = false;
  elements.screenViewControls.hidden = !stream;
  refreshScreenStreamControls(peer);
  elements.leaveButton.hidden = true;
  elements.screenExitButton.hidden = false;
  mountIcons(elements.screenExitButton);
  elements.screenPlaceholder.hidden = Boolean(stream);
  refreshScreenMeta(peer);
  syncScreenStagePointerState();

  if (stream && elements.screenVideo.srcObject !== stream) {
    elements.screenVideo.srcObject = stream;
  }
  if (stream) {
    syncScreenVideoAudio();
    playMediaElement(elements.screenVideo);
  } else {
    elements.screenVideo.pause();
    elements.screenVideo.srcObject = null;
  }
  refreshScreenTiles();
  refreshStageStripControls();
}

export function hideScreenStage(): void {
  state.sharedScreenPeerId = '';
  delete document.body.dataset.screenView;
  stopScreenStageIdleUi();
  elements.screenStage.hidden = true;
  elements.screenViewControls.hidden = true;
  elements.screenMeta.hidden = true;
  elements.screenPlaceholder.hidden = false;
  elements.screenExitButton.hidden = true;
  elements.leaveButton.hidden = false;
  elements.screenVideo.pause();
  elements.screenVideo.srcObject = null;
  if (document.fullscreenElement === elements.screenStage) {
    document.exitFullscreen().catch(() => {});
  }
  if (document.body.dataset.desktopScreenFullscreen === 'true') {
    setDesktopScreenFullscreen(false).catch((error) => console.error(error));
  }
  refreshScreenTiles();
  refreshStageStripControls();
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

function getScreenStreamForParticipant(participant: Participant | null): MediaStream | null {
  if (!participant?.screen) return null;
  return participant.isLocal ? state.localScreenStream : participant.screenStream;
}

function setViewedScreenPeerId(peerId: string): void {
  state.viewedScreenPeerId = peerId || '';
  if (state.self) state.self.viewedScreenPeerId = state.viewedScreenPeerId;
}

function getStreamTileStateKey(participant: Participant): string {
  const hasPreview = hasStreamTilePreview(participant);
  const isCollapsed = isStreamTileCollapsed(participant);
  const stream = getScreenStreamForParticipant(participant);
  return [
    participant.id,
    hasPreview,
    isCollapsed,
    stream?.id || '',
    participant.isLocal ? state.localScreenProfileId : participant.screenProfileId,
    participant.name,
    isScreenSubscribed(participant.id)
  ].join('|');
}

function openScreenTile(peerId: string): void {
  enterScreenView(peerId).catch((error) => console.error(error));
}

export function refreshScreenTiles(): void {
  const screenParticipants = getScreenParticipants()
    .filter((participant) => participant.id !== state.viewedScreenPeerId);
  elements.streamTiles.hidden = screenParticipants.length === 0;
  elements.streamTiles.dataset.count = String(Math.min(screenParticipants.length, 8));

  const existingTiles = new Map<string, { key: string; node: HTMLElement }>();
  for (const node of elements.streamTiles.querySelectorAll<HTMLElement>('.stream-tile[data-peer-id]')) {
    const peerId = node.dataset.peerId;
    if (!peerId) continue;
    existingTiles.set(peerId, { key: node.dataset.tileState || '', node });
  }

  const nextTiles: HTMLElement[] = [];
  for (const participant of screenParticipants) {
    const stateKey = getStreamTileStateKey(participant);
    const cached = existingTiles.get(participant.id);
    if (cached?.key === stateKey) {
      nextTiles.push(cached.node);
      existingTiles.delete(participant.id);
      continue;
    }

    const tile = createStreamTile({
      hasPreview: hasStreamTilePreview(participant),
      isCollapsed: isStreamTileCollapsed(participant),
      isSubscribed: isScreenSubscribed(participant.id),
      onEnter: openScreenTile,
      participant,
      stream: getScreenStreamForParticipant(participant)
    });
    tile.dataset.peerId = participant.id;
    tile.dataset.tileState = stateKey;
    nextTiles.push(tile);
  }

  elements.streamTiles.replaceChildren(...nextTiles);

  refreshStageStripControls();
  bumpParticipantsRevision();
}

function hasStreamTilePreview(participant: Participant): boolean {
  return isScreenSubscribed(participant.id) && Boolean(getScreenStreamForParticipant(participant));
}

function isStreamTileCollapsed(participant: Participant): boolean {
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
