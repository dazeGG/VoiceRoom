import { elements } from './dom';
import { state } from '../core/state';
import { showToast } from './toast';
import { getScreenProfile } from '../media/profiles';
import { getInitials } from '../core/utils';
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

let screenUiHoverBound = false;

async function toggleScreenTile(peerId: string): Promise<void> {
  if (state.viewedScreenPeerId === peerId) {
    await leaveScreenView();
    return;
  }

  await enterScreenView(peerId);
}

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

  leaveScreenView().catch((error) => console.error(error));
}

export async function enterScreenView(peerId: string): Promise<void> {
  const peer = getParticipantById(peerId);
  if (!peer?.screen) {
    showToast('Демонстрация уже завершена');
    refreshAllScreenActions();
    refreshScreenTiles();
    return;
  }

  if (state.viewedScreenPeerId === peerId) return;
  if (state.viewedScreenPeerId) {
    await leaveScreenView({ quiet: true });
  }

  setViewedScreenPeerId(peerId);
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

export async function leaveScreenView(options: { quiet?: boolean } = {}): Promise<void> {
  const { quiet = false } = options;
  const peerId = closeScreenView();
  if (!peerId) return;

  const peer = getParticipantById(peerId);
  if (peer && !peer.isLocal) syncLiveKitScreenSubscriptions(peer);
  if (!quiet) refreshAllScreenActions();
  postState().catch(() => {});
}

export function closeScreenView(): string {
  const peerId = state.viewedScreenPeerId;
  setViewedScreenPeerId('');
  state.screenRequesting = false;
  state.stripCollapsed = false;

  const peer = getParticipantById(peerId);
  if (peer && !peer.isLocal && peer.screenStream) {
    detachRemoteScreen(peer);
  } else {
    hideScreenStage();
  }
  refreshAllScreenActions();
  refreshScreenTiles();
  return peerId;
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

export function refreshScreenStage(): void {
  const peer = getActiveScreenPeer();
  if (!peer?.screen) {
    if (state.viewedScreenPeerId) closeScreenView();
    else hideScreenStage();
    return;
  }

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
  elements.screenPlaceholder.hidden = Boolean(stream);
  refreshScreenMeta(peer);
  syncScreenStageUiVisibility();

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

export function refreshScreenTiles(): void {
  elements.streamTiles.textContent = '';

  const screenParticipants = getScreenParticipants()
    .filter((participant) => participant.id !== state.viewedScreenPeerId);
  elements.streamTiles.hidden = screenParticipants.length === 0;
  elements.streamTiles.dataset.count = String(Math.min(screenParticipants.length, 8));

  for (const participant of screenParticipants) {
    elements.streamTiles.append(createStreamTile(participant));
  }

  refreshStageStripControls();
  refreshStageGridState();
}

function createStreamTile(participant: Participant): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'stream-tile';
  button.type = 'button';
  button.dataset.active = String(state.viewedScreenPeerId === participant.id);
  button.dataset.local = String(participant.isLocal);
  button.setAttribute('aria-pressed', String(state.viewedScreenPeerId === participant.id));
  button.setAttribute(
    'aria-label',
    state.viewedScreenPeerId === participant.id
      ? `Свернуть стрим ${participant.name} до плитки`
      : `Открыть стрим ${participant.name}`
  );

  const preview = document.createElement('span');
  preview.className = 'stream-tile-preview';
  preview.append(createStreamTileIcon(), createStreamTileInitials(participant));

  const copy = document.createElement('span');
  copy.className = 'stream-tile-copy';

  const title = document.createElement('strong');
  title.textContent = participant.isLocal ? 'Ваш стрим' : `Стрим ${participant.name}`;

  const action = document.createElement('span');
  action.className = 'stream-tile-action';
  action.textContent = state.viewedScreenPeerId === participant.id ? 'Свернуть стрим' : 'Смотреть стрим';

  copy.append(title);
  button.append(preview, copy, action);
  button.addEventListener('click', () => toggleScreenTile(participant.id).catch((error) => console.error(error)));
  return button;
}

function createStreamTileIcon(): HTMLElement {
  const icon = document.createElement('span');
  icon.className = 'stream-tile-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" focusable="false">
      <path d="M4 5a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z"></path>
      <path d="M8 21h8"></path>
      <path d="M12 15v6"></path>
    </svg>
  `;
  return icon;
}

function createStreamTileInitials(participant: Participant): HTMLElement {
  const initials = document.createElement('span');
  initials.className = 'stream-tile-initials';
  initials.textContent = getInitials(participant.name);
  return initials;
}

export function refreshScreenMeta(participant: Participant | null): void {
  if (!participant) {
    elements.screenMeta.hidden = true;
    return;
  }

  elements.screenMeta.hidden = false;
  elements.screenMetaTitle.textContent = participant.isLocal ? 'Ваш стрим' : `Стрим ${participant.name}`;
  const profileLabel = getScreenProfileLabel(participant);
  elements.screenMetaProfile.hidden = !profileLabel;
  elements.screenMetaProfile.textContent = profileLabel;
  elements.screenMetaSepProfile.hidden = !profileLabel;
  elements.screenMetaStats.hidden = true;
  elements.screenMetaStats.textContent = '';
  const viewersLine = formatScreenViewersLine(participant.id);
  elements.screenMetaViewers.textContent = viewersLine;
  elements.screenMetaViewers.hidden = !viewersLine;
  elements.screenMetaSepViewers.hidden = !profileLabel || !viewersLine;
  refreshScreenStreamControls(participant);
}

function refreshScreenStreamControls(participant: Participant | null): void {
  const hideVolume = Boolean(participant?.isLocal);
  elements.streamVolumeControl.hidden = hideVolume;
}

function getScreenProfileLabel(participant: Participant): string {
  const profile = getScreenProfile(participant.isLocal ? state.localScreenProfileId : participant.screenProfileId);
  return profile.label;
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
    syncScreenStageUiVisibility();
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
  const showScreenStageUi = () => {
    if (stage.hidden) return;
    stage.dataset.uiActive = 'true';
  };
  const scheduleHideScreenStageUi = () => {
    window.requestAnimationFrame(() => {
      syncScreenStageUiVisibility();
    });
  };

  stage.addEventListener('pointerenter', showScreenStageUi);
  stage.addEventListener('pointerleave', scheduleHideScreenStageUi);
  stage.addEventListener('touchstart', showScreenStageUi, { passive: true });
  document.addEventListener(
    'touchstart',
    (event) => {
      if (stage.hidden) return;
      const target = event.target;
      if (target instanceof Node && stage.contains(target)) {
        showScreenStageUi();
        return;
      }
      scheduleHideScreenStageUi();
    },
    { passive: true }
  );
}

function syncScreenStageUiVisibility(): void {
  const stage = elements.screenStage;
  if (stage.hidden) return;

  if (stage.matches(':hover')) {
    stage.dataset.uiActive = 'true';
    return;
  }

  delete stage.dataset.uiActive;
}

function stopScreenStageIdleUi(): void {
  delete elements.screenStage.dataset.uiActive;
}
