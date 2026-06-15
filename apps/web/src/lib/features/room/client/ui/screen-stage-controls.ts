import { elements } from './dom';
import { getAvatarColor } from '$lib/visual/tokens';
import { state } from '../core/state';
import { showToast } from './toast';
import { getInitials } from '../core/utils';
import { getScreenProfile, parseScreenProfileId } from '../media/profiles';
import { SCREEN_FPS_OPTIONS, SCREEN_QUALITY_OPTIONS } from '../core/config';
import { clampStreamVolume, normalizeStoredStreamVolume, storeStreamVolume } from '../core/settings';
import {
  isAppPlaybackMuted,
  applyAudioOutputDevice,
  applyScreenMediaElementVolume,
  getAvailableScreenMediaElementVolumeMax
} from '../services/media-playback-service';
import { getAllParticipants } from '../room/participants';
import type { Participant } from '../core/types';

const SCREEN_UI_IDLE_MS = 1000;
let screenUiIdleTimer = 0;
let screenStagePointerInside = false;
let screenUiHoverBound = false;

export interface ScreenStageControlOptions {
  getActiveScreenPeer: () => Participant | null;
}

let getActiveScreenPeerRef: () => Participant | null = () => null;

export function configureScreenStageControls(options: ScreenStageControlOptions): void {
  getActiveScreenPeerRef = options.getActiveScreenPeer;
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
  const hasViewers = renderScreenViewers(participant.id);
  elements.screenMetaViewers.hidden = !hasViewers;
  elements.screenMetaSepViewers.hidden = (!qualityLabel && !fpsLabel) || !hasViewers;
  refreshScreenStreamControls(participant);
}

export function refreshScreenStreamControls(participant: Participant | null): void {
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

function renderScreenViewers(ownerPeerId: string): boolean {
  const viewers = getScreenViewers(ownerPeerId);
  elements.screenMetaViewers.replaceChildren();
  if (viewers.length === 0) {
    elements.screenMetaViewers.textContent = 'Смотрят: 0';
    return true;
  }

  for (const viewer of viewers.slice(0, 3)) {
    elements.screenMetaViewers.append(createScreenViewerAvatar(viewer));
  }

  const rest = viewers.length - 3;
  if (rest > 0) {
    const restBadge = document.createElement('span');
    restBadge.className = 'screen-meta-viewers-rest';
    restBadge.textContent = `+${rest}`;
    elements.screenMetaViewers.append(restBadge);
  }
  return true;
}

function createScreenViewerAvatar(viewer: Participant): HTMLElement {
  const avatarColor = getAvatarColor(viewer.avatarColorKey);
  const avatar = document.createElement('span');
  avatar.className = 'screen-meta-viewer-avatar';
  avatar.title = viewer.isLocal ? 'вы' : viewer.name;
  avatar.setAttribute('role', 'img');
  avatar.setAttribute('aria-label', viewer.isLocal ? 'вы' : viewer.name);
  avatar.style.setProperty('--avatar-bg', avatarColor.background);
  avatar.style.setProperty('--avatar-fg', avatarColor.foreground);
  avatar.style.setProperty('--avatar-shadow', avatarColor.shadow);
  avatar.textContent = getInitials(viewer.name);
  return avatar;
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
  const peer = getActiveScreenPeerRef();
  const isLocalStream = Boolean(peer?.isLocal);
  const isRemoteStreamActive = Boolean(peer && !peer.isLocal && elements.screenVideo.srcObject);
  const maxStreamVolume = getAvailableScreenMediaElementVolumeMax();
  const streamVolume = clampStreamVolume(state.screenVolume, maxStreamVolume);
  if (state.screenVolume !== streamVolume) {
    state.screenVolume = normalizeStoredStreamVolume(state.screenVolume, maxStreamVolume);
  }
  const muted =
    isLocalStream || state.screenMuted || streamVolume <= 0 || isAppPlaybackMuted();
  applyScreenMediaElementVolume(elements.screenVideo, {
    boostAllowed: isRemoteStreamActive,
    muted,
    volume: isLocalStream ? 0 : streamVolume
  });
  applyAudioOutputDevice(elements.screenVideo).catch(() => {});
  if (!isLocalStream) {
    elements.streamVolumeSlider.max = String(maxStreamVolume * 100);
    elements.streamVolumeSlider.value = String(Math.round(streamVolume * 100));
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
    state.screenVolume = storeStreamVolume(state.screenVolume, getAvailableScreenMediaElementVolumeMax());
  } else {
    state.screenMuted = true;
  }
  syncScreenVideoAudio();
}

export function updateScreenVolumeFromSlider(): void {
  const nextVolume = Number(elements.streamVolumeSlider.value) / 100;
  state.screenVolume = storeStreamVolume(nextVolume, getAvailableScreenMediaElementVolumeMax());
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

export async function setDesktopScreenFullscreen(fullscreen: boolean): Promise<void> {
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

function activateScreenStageUi(): void {
  window.clearTimeout(screenUiIdleTimer);
  elements.screenStage.dataset.uiActive = 'true';

  if (!screenStagePointerInside) return;

  screenUiIdleTimer = window.setTimeout(() => {
    if (!screenStagePointerInside || elements.screenStage.hidden) return;

    blurFocusedStreamControl();
    delete elements.screenStage.dataset.uiActive;
  }, SCREEN_UI_IDLE_MS);
}

function blurFocusedStreamControl(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (!elements.screenViewControls.contains(active)) return;

  // `screenViewControls` is the explicit stream-HUD focus boundary. Keep
  // controls that should surrender focus on idle inside this subtree so
  // pointer inactivity can hide the HUD without touching broader room chrome.
  active.blur();
}

function deactivateScreenStageUi(): void {
  window.clearTimeout(screenUiIdleTimer);
  screenUiIdleTimer = 0;
  delete elements.screenStage.dataset.uiActive;
}

export function syncScreenStagePointerState(): void {
  const stage = elements.screenStage;
  if (stage.hidden) return;

  screenStagePointerInside = stage.matches(':hover');
  if (screenStagePointerInside) {
    activateScreenStageUi();
    return;
  }

  deactivateScreenStageUi();
}

export function stopScreenStageIdleUi(): void {
  screenStagePointerInside = false;
  deactivateScreenStageUi();
}
