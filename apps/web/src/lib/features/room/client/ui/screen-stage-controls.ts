import { state } from '../core/state.svelte';
import { showToast } from './toast';
import { clampStreamVolume, normalizeStoredStreamVolume, storeStreamVolume } from '../core/settings';
import {
  isAppPlaybackMuted,
  applyAudioOutputDevice,
  applyScreenMediaElementVolume,
  getAvailableScreenMediaElementVolumeMax
} from '../services/media-playback-service';
import {
  bumpScreenUiRevision,
  getActiveScreenPeer,
  getScreenStage,
  getScreenVideo,
  getStreamVolumeSlider,
  screenUi
} from '../../screen-ui.svelte';
import type { Participant } from '../core/types';

const SCREEN_UI_IDLE_MS = 1000;
let screenUiIdleTimer = 0;
let screenStagePointerInside = false;
let screenUiHoverBound = false;

export function refreshScreenMeta(participant: Participant | null): void {
  screenUi.showMeta = Boolean(participant);
  bumpScreenUiRevision();
}

export function refreshScreenStreamControls(_participant: Participant | null): void {
  bumpScreenUiRevision();
}

export function refreshStageStripControls(): void {
  state.stripCollapsed = false;
  delete document.body.dataset.stripCollapsed;
  document.body.dataset.stageSummary = 'hidden';
}

export function syncScreenVideoAudio(): void {
  const video = getScreenVideo();
  if (!video) return;

  const peer = getActiveScreenPeer();
  const isLocalStream = Boolean(peer?.isLocal);
  const isRemoteStreamActive = Boolean(peer && !peer.isLocal && video.srcObject);
  const maxStreamVolume = getAvailableScreenMediaElementVolumeMax();
  const streamVolume = clampStreamVolume(state.screenVolume, maxStreamVolume);
  if (state.screenVolume !== streamVolume) {
    state.screenVolume = normalizeStoredStreamVolume(state.screenVolume, maxStreamVolume);
  }
  const muted = isLocalStream || state.screenMuted || streamVolume <= 0 || isAppPlaybackMuted();
  applyScreenMediaElementVolume(video, {
    boostAllowed: isRemoteStreamActive,
    muted,
    volume: isLocalStream ? 0 : streamVolume
  });
  applyAudioOutputDevice(video).catch(() => {});

  const slider = getStreamVolumeSlider();
  if (!isLocalStream && slider) {
    slider.max = String(maxStreamVolume * 100);
    slider.value = String(Math.round(streamVolume * 100));
  }
  bumpScreenUiRevision();
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
  const slider = getStreamVolumeSlider();
  if (!slider) return;
  const nextVolume = Number(slider.value) / 100;
  state.screenVolume = storeStreamVolume(nextVolume, getAvailableScreenMediaElementVolumeMax());
  state.screenMuted = state.screenVolume <= 0;
  syncScreenVideoAudio();
}

export async function toggleScreenFullscreen(): Promise<void> {
  const stage = getScreenStage();
  if (!stage) return;

  try {
    if (document.fullscreenElement === stage) {
      await document.exitFullscreen();
      return;
    }

    if (document.body.dataset.desktopScreenFullscreen === 'true') {
      await setDesktopScreenFullscreen(false);
      return;
    }

    if (document.fullscreenEnabled) {
      try {
        await stage.requestFullscreen();
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
  const stage = getScreenStage();
  const active = await window.voiceRoomWindow!.setFullscreen(fullscreen);
  if (active) {
    document.body.dataset.desktopScreenFullscreen = 'true';
  } else {
    delete document.body.dataset.desktopScreenFullscreen;
  }
  setScreenFullscreenState(active || document.fullscreenElement === stage);
}

export function updateScreenFullscreenState(): void {
  const stage = getScreenStage();
  const fullscreen = Boolean(stage && document.fullscreenElement === stage);
  if (!fullscreen && document.body.dataset.desktopScreenFullscreen !== 'true') {
    setScreenFullscreenState(false);
    return;
  }

  setScreenFullscreenState(fullscreen || document.body.dataset.desktopScreenFullscreen === 'true');
  if (screenUi.stageVisible) {
    syncScreenStagePointerState();
  }
}

function setScreenFullscreenState(fullscreen: boolean): void {
  state.screenFullscreen = fullscreen;
  bumpScreenUiRevision();
}

export function bindScreenStageIdleUi(signal?: AbortSignal): void {
  if (screenUiHoverBound) return;
  screenUiHoverBound = true;
  signal?.addEventListener('abort', resetScreenStageIdleUi, { once: true });

  const stage = getScreenStage();
  if (!stage) return;

  const wakeScreenStageUi = () => {
    if (!screenStagePointerInside || !screenUi.stageVisible) return;
    activateScreenStageUi();
  };

  stage.addEventListener('pointerenter', () => {
    screenStagePointerInside = true;
    activateScreenStageUi();
  }, { signal });
  stage.addEventListener('pointerleave', () => {
    screenStagePointerInside = false;
    deactivateScreenStageUi();
  }, { signal });
  stage.addEventListener('pointermove', wakeScreenStageUi, { signal });
  stage.addEventListener('mousedown', wakeScreenStageUi, { signal });
  stage.addEventListener('wheel', wakeScreenStageUi, { passive: true, signal });
  stage.addEventListener('touchstart', () => {
    screenStagePointerInside = true;
    activateScreenStageUi();
  }, { passive: true, signal });
  document.addEventListener(
    'touchstart',
    (event) => {
      if (!screenUi.stageVisible || !stage) return;
      const target = event.target;
      if (target instanceof Node && stage.contains(target)) {
        screenStagePointerInside = true;
        activateScreenStageUi();
        return;
      }
      screenStagePointerInside = false;
      deactivateScreenStageUi();
    },
    { passive: true, signal }
  );
}

function resetScreenStageIdleUi(): void {
  screenUiHoverBound = false;
  screenStagePointerInside = false;
  window.clearTimeout(screenUiIdleTimer);
  screenUi.uiActive = false;
}

function activateScreenStageUi(): void {
  window.clearTimeout(screenUiIdleTimer);
  screenUi.uiActive = true;
  if (!screenStagePointerInside) return;

  screenUiIdleTimer = window.setTimeout(() => {
    if (!screenStagePointerInside || !screenUi.stageVisible) return;
    blurFocusedStreamControl();
    screenUi.uiActive = false;
  }, SCREEN_UI_IDLE_MS);
}

function blurFocusedStreamControl(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  const controls = document.getElementById('screenViewControls');
  if (!controls?.contains(active)) return;
  active.blur();
}

function deactivateScreenStageUi(): void {
  window.clearTimeout(screenUiIdleTimer);
  screenUiIdleTimer = 0;
  screenUi.uiActive = false;
}

export function syncScreenStagePointerState(): void {
  const stage = getScreenStage();
  if (!stage || !screenUi.stageVisible) return;

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