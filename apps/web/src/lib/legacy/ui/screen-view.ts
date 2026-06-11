import { elements } from './dom';
import { mountIcons, renderIcon } from './icons';
import { state } from '../core/state';
import { showToast } from './toast';
import { getScreenProfile, parseScreenProfileId } from '../media/profiles';
import { SCREEN_FPS_OPTIONS, SCREEN_QUALITY_OPTIONS } from '../core/config';

import { postState } from '../room/presence';
import { isAppPlaybackMuted, applyAudioOutputDevice, playMediaElement } from '../media/playback';
import { syncLiveKitScreenSubscriptions } from '../room/livekit';
import {
  detachRemoteScreen,
  getAllParticipants,
  getParticipantById,
  refreshStageGridState
} from '../room/participants';
import type { Participant } from '../core/types';

const SCREEN_UI_IDLE_MS = 2200;
let screenUiIdleTimer = 0;
let screenStagePointerInside = false;
let screenUiHoverBound = false;

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
    peer.node.dataset.screen = 'true';
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

export function refreshScreenAction(participant: Participant | null): void {
  if (!participant?.screenAction) return;

  const viewing = state.viewedScreenPeerId === participant.id;
  const canWatch = !participant.isLocal && participant.screen && !viewing;
  participant.screenAction.hidden = !canWatch;
  participant.screenAction.disabled = state.screenRequesting;
  participant.screenAction.querySelector('span')!.textContent = state.screenRequesting ? 'Подключение' : 'Смотреть экран';
}

export function refreshAllScreenActions(): void {
  if (state.self) refreshScreenAction(state.self);
  for (const peer of state.peers.values()) refreshScreenAction(peer);
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
    participant.name,
    isScreenSubscribed(participant.id)
  ].join('|');
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

    const tile = createStreamTile(participant);
    tile.dataset.peerId = participant.id;
    tile.dataset.tileState = stateKey;
    nextTiles.push(tile);
  }

  elements.streamTiles.replaceChildren(...nextTiles);

  refreshStageStripControls();
  refreshStageGridState();
}

function hasStreamTilePreview(participant: Participant): boolean {
  return isScreenSubscribed(participant.id) && Boolean(getScreenStreamForParticipant(participant));
}

function isStreamTileCollapsed(participant: Participant): boolean {
  return state.screenCollapsedPeerIds.has(participant.id) && hasStreamTilePreview(participant);
}

function createStreamTile(participant: Participant): HTMLElement {
  const subscribed = isScreenSubscribed(participant.id);
  const hasPreview = hasStreamTilePreview(participant);
  const isCollapsed = isStreamTileCollapsed(participant);
  const isIdle = !hasPreview;
  const stream = getScreenStreamForParticipant(participant);

  const tile = document.createElement(isCollapsed ? 'div' : 'button');
  tile.className = 'stream-tile';
  if (tile instanceof HTMLButtonElement) {
    tile.type = 'button';
  } else {
    tile.setAttribute('role', 'group');
  }
  tile.dataset.preview = String(hasPreview);
  tile.dataset.collapsed = String(isCollapsed);
  tile.dataset.idle = String(isIdle);
  tile.dataset.local = String(participant.isLocal);
  const isActive = hasPreview || subscribed;
  if (tile instanceof HTMLButtonElement) {
    tile.setAttribute('aria-pressed', String(isActive));
    tile.setAttribute(
      'aria-label',
      hasPreview
        ? `Развернуть стрим ${participant.name}`
        : subscribed
          ? `Подключение к стриму ${participant.name}`
          : `Смотреть стрим ${participant.name}`
    );
  }

  const preview = document.createElement('span');
  preview.className = 'stream-tile-preview';
  if (hasPreview && stream) {
    mountStreamTileVideo(preview, stream);
  } else {
    preview.append(createStreamTileIcon());
  }

  tile.append(preview);

  if (isCollapsed) {
    const copy = document.createElement('span');
    copy.className = 'stream-tile-copy';
    const title = document.createElement('strong');
    title.textContent = participant.isLocal ? 'Ваш стрим' : participant.name;
    copy.append(title);

    const expandButton = document.createElement('button');
    expandButton.type = 'button';
    expandButton.className = 'stream-tile-expand';
    expandButton.setAttribute('aria-pressed', String(isActive));
    expandButton.setAttribute(
      'aria-label',
      `Развернуть стрим ${participant.isLocal ? 'ваш' : participant.name}`
    );
    expandButton.addEventListener('click', () => {
      enterScreenView(participant.id).catch((error) => console.error(error));
    });

    const actions = document.createElement('span');
    actions.className = 'stream-tile-actions stream-tile-actions-collapsed';
    const disconnectAction = document.createElement('button');
    disconnectAction.type = 'button';
    disconnectAction.className = 'stream-tile-action stream-tile-action-disconnect';
    disconnectAction.textContent = 'Отключиться';
    disconnectAction.addEventListener('click', (event) => {
      event.stopPropagation();
      disconnectScreen(participant.id);
    });
    actions.append(disconnectAction);

    tile.append(expandButton, copy, actions);
  } else if (isIdle) {
    const copy = document.createElement('span');
    copy.className = 'stream-tile-copy stream-tile-copy-idle';
    const title = document.createElement('strong');
    title.textContent = participant.isLocal ? 'Ваш стрим' : participant.name;
    copy.append(title);

    const actions = document.createElement('span');
    actions.className = 'stream-tile-actions';
    const primaryAction = document.createElement('span');
    primaryAction.className = 'stream-tile-action stream-tile-action-primary';
    primaryAction.textContent = subscribed ? 'Подключение' : 'Смотреть стрим';
    actions.append(primaryAction);

    tile.append(copy, actions);
  }

  if (tile instanceof HTMLButtonElement) {
    tile.addEventListener('click', () => {
      enterScreenView(participant.id).catch((error) => console.error(error));
    });
  }
  return tile;
}

function mountStreamTileVideo(preview: HTMLElement, stream: MediaStream): void {
  const video = document.createElement('video');
  video.className = 'stream-tile-video';
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  preview.append(video);
  playMediaElement(video);
}

function createStreamTileIcon(): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'stream-tile-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = renderIcon('monitor');
  return icon;
}

export function refreshScreenMeta(participant: Participant | null): void {
  if (!participant) {
    elements.screenMeta.hidden = true;
    return;
  }

  elements.screenMeta.hidden = false;
  elements.screenMetaTitle.textContent = participant.isLocal ? 'Ваш стрим' : `Стрим ${participant.name}`;
  const { qualityLabel, fpsLabel } = getScreenMetaLabels(participant);
  elements.screenMetaQuality.hidden = !qualityLabel;
  elements.screenMetaQuality.textContent = qualityLabel;
  elements.screenMetaFps.hidden = !fpsLabel;
  elements.screenMetaFps.textContent = fpsLabel;
  elements.screenMetaSepProfile.hidden = !qualityLabel;
  elements.screenMetaSepFps.hidden = !qualityLabel || !fpsLabel;
  elements.screenMetaStats.hidden = true;
  elements.screenMetaStats.textContent = '';
  const viewersLine = formatScreenViewersLine(participant.id);
  elements.screenMetaViewers.textContent = viewersLine;
  elements.screenMetaViewers.hidden = !viewersLine;
  elements.screenMetaSepViewers.hidden = (!qualityLabel && !fpsLabel) || !viewersLine;
  refreshScreenStreamControls(participant);
}

function refreshScreenStreamControls(participant: Participant | null): void {
  const hideVolume = Boolean(participant?.isLocal);
  elements.streamVolumeControl.hidden = hideVolume;
}

function getScreenMetaLabels(participant: Participant): { qualityLabel: string; fpsLabel: string } {
  const profile = getScreenProfile(participant.isLocal ? state.localScreenProfileId : participant.screenProfileId);
  const { qualityId, fpsId } = parseScreenProfileId(profile.id);
  const quality = SCREEN_QUALITY_OPTIONS[qualityId];
  const fps = SCREEN_FPS_OPTIONS[fpsId];
  return {
    qualityLabel: quality?.label || '',
    fpsLabel: fps?.label || ''
  };
}

function formatScreenViewersLine(ownerPeerId: string): string {
  const viewers = getScreenViewers(ownerPeerId);
  if (viewers.length === 0) return 'Смотрят: 0';

  const names = viewers.slice(0, 3).map((viewer) => (viewer.isLocal ? 'вы' : viewer.name));
  const rest = viewers.length - names.length;
  return rest > 0 ? `Смотрят: ${names.join(', ')} +${rest}` : `Смотрят: ${names.join(', ')}`;
}

function getScreenViewers(ownerPeerId: string): Participant[] {
  return getAllParticipants().filter((participant) => participant.viewedScreenPeerId === ownerPeerId);
}

export function refreshStageStripControls(): void {
  state.stripCollapsed = false;
  elements.stageStripKicker.textContent = '';
  elements.stageStripSummary.textContent = '';
  elements.stripToggleButton.hidden = true;
  elements.stripToggleButton.setAttribute('aria-pressed', 'false');
  elements.stripToggleButton.setAttribute('aria-label', 'Свернуть пользователей');
  delete document.body.dataset.stripCollapsed;
  document.body.dataset.stageSummary = 'hidden';
}

export function syncScreenVideoAudio(): void {
  const peer = getActiveScreenPeer();
  const isLocalStream = Boolean(peer?.isLocal);
  const muted =
    isLocalStream || state.screenMuted || state.screenVolume <= 0 || isAppPlaybackMuted();
  elements.screenVideo.volume = isLocalStream ? 0 : state.screenVolume;
  elements.screenVideo.muted = muted;
  applyAudioOutputDevice(elements.screenVideo).catch(() => {});
  if (!isLocalStream) {
    elements.streamVolumeSlider.value = String(Math.round(state.screenVolume * 100));
    elements.streamVolumeButton.dataset.muted = String(muted);
    elements.streamVolumeButton.setAttribute('aria-pressed', String(muted));
    elements.streamVolumeButton.setAttribute(
      'aria-label',
      muted ? 'Включить звук стрима' : 'Выключить звук стрима'
    );
  }
}

export function toggleScreenMute(): void {
  if (state.screenMuted || state.screenVolume <= 0) {
    state.screenMuted = false;
    if (state.screenVolume <= 0) state.screenVolume = 1;
  } else {
    state.screenMuted = true;
  }
  syncScreenVideoAudio();
}

export function updateScreenVolumeFromSlider(): void {
  const nextVolume = Number(elements.streamVolumeSlider.value) / 100;
  state.screenVolume = Number.isFinite(nextVolume) ? Math.min(1, Math.max(0, nextVolume)) : 1;
  state.screenMuted = state.screenVolume <= 0;
  syncScreenVideoAudio();
}

export async function toggleScreenFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement === elements.screenStage) {
      await document.exitFullscreen();
      return;
    }

    if (document.body.dataset.desktopScreenFullscreen === 'true') {
      await setDesktopScreenFullscreen(false);
      return;
    }

    if (document.fullscreenEnabled) {
      try {
        await elements.screenStage.requestFullscreen();
        return;
      } catch (error) {
        if (!hasDesktopWindowControls()) throw error;
        console.warn('Stage fullscreen unavailable, using desktop window fullscreen', error);
      }
    }

    if (hasDesktopWindowControls()) {
      await setDesktopScreenFullscreen(true);
    } else {
      showToast('Полноэкранный режим недоступен');
    }
  } catch (error) {
    console.error(error);
    showToast('Не удалось переключить полноэкранный режим');
  }
}

function hasDesktopWindowControls(): boolean {
  return Boolean(window.voiceRoomWindow?.setFullscreen);
}

async function setDesktopScreenFullscreen(fullscreen: boolean): Promise<void> {
  const active = await window.voiceRoomWindow!.setFullscreen(fullscreen);
  if (active) {
    document.body.dataset.desktopScreenFullscreen = 'true';
  } else {
    delete document.body.dataset.desktopScreenFullscreen;
  }
  setScreenFullscreenState(active || document.fullscreenElement === elements.screenStage);
}

export function updateScreenFullscreenState(): void {
  const fullscreen = document.fullscreenElement === elements.screenStage;
  if (!fullscreen && document.body.dataset.desktopScreenFullscreen !== 'true') {
    setScreenFullscreenState(false);
    return;
  }

  setScreenFullscreenState(fullscreen || document.body.dataset.desktopScreenFullscreen === 'true');
  if (!elements.screenStage.hidden) {
    syncScreenStagePointerState();
  }
}

function setScreenFullscreenState(fullscreen: boolean): void {
  state.screenFullscreen = fullscreen;
  elements.screenFullscreenButton.dataset.fullscreen = String(fullscreen);
  elements.screenFullscreenButton.setAttribute('aria-pressed', String(fullscreen));
  elements.screenFullscreenButton.setAttribute(
    'aria-label',
    fullscreen ? 'Выйти из полноэкранного режима' : 'Открыть стрим на весь экран'
  );
}

export function bindScreenStageIdleUi(): void {
  if (screenUiHoverBound) return;
  screenUiHoverBound = true;

  const stage = elements.screenStage;
  const wakeScreenStageUi = () => {
    if (!screenStagePointerInside || stage.hidden) return;
    activateScreenStageUi();
  };

  stage.addEventListener('pointerenter', () => {
    screenStagePointerInside = true;
    activateScreenStageUi();
  });
  stage.addEventListener('pointerleave', () => {
    screenStagePointerInside = false;
    deactivateScreenStageUi();
  });
  stage.addEventListener('pointermove', wakeScreenStageUi);
  stage.addEventListener('mousedown', wakeScreenStageUi);
  stage.addEventListener('wheel', wakeScreenStageUi, { passive: true });
  stage.addEventListener('touchstart', () => {
    screenStagePointerInside = true;
    activateScreenStageUi();
  }, { passive: true });
  document.addEventListener(
    'touchstart',
    (event) => {
      if (stage.hidden) return;
      const target = event.target;
      if (target instanceof Node && stage.contains(target)) {
        screenStagePointerInside = true;
        activateScreenStageUi();
        return;
      }
      screenStagePointerInside = false;
      deactivateScreenStageUi();
    },
    { passive: true }
  );
}

function shouldDeferScreenUiIdle(): boolean {
  return elements.screenViewControls.matches(':hover') || elements.screenViewControls.matches(':focus-within');
}

function activateScreenStageUi(): void {
  window.clearTimeout(screenUiIdleTimer);
  elements.screenStage.dataset.uiActive = 'true';

  if (!screenStagePointerInside) return;

  screenUiIdleTimer = window.setTimeout(() => {
    if (!screenStagePointerInside || elements.screenStage.hidden) return;
    if (shouldDeferScreenUiIdle()) {
      activateScreenStageUi();
      return;
    }

    const active = document.activeElement;
    if (active instanceof HTMLElement && elements.screenViewControls.contains(active)) {
      active.blur();
    }

    delete elements.screenStage.dataset.uiActive;
  }, SCREEN_UI_IDLE_MS);
}

function deactivateScreenStageUi(): void {
  window.clearTimeout(screenUiIdleTimer);
  screenUiIdleTimer = 0;
  delete elements.screenStage.dataset.uiActive;
}

function syncScreenStagePointerState(): void {
  const stage = elements.screenStage;
  if (stage.hidden) return;

  screenStagePointerInside = stage.matches(':hover');
  if (screenStagePointerInside) {
    activateScreenStageUi();
    return;
  }

  deactivateScreenStageUi();
}

function stopScreenStageIdleUi(): void {
  screenStagePointerInside = false;
  deactivateScreenStageUi();
}
