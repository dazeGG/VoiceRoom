import { callPageState } from '../core/call-page.store';
import { getInstalledCallPorts } from '../ports';
import { t } from '@voiceroom/ui-kit/i18n';
import { state } from '../core/room-runtime.store';
import { showToast } from './toast';
import { clampStreamVolume, normalizeStoredStreamVolume, storeStreamVolume } from '../core/settings';
import { MAX_STREAM_VOLUME } from '../core/config';
import {
  isAppPlaybackMuted,
  applyScreenMediaElementVolume,
  releaseScreenMediaElement
} from '../services/media-playback-service';
import { useScreenUiStore } from '../core/screen-ui.store';
import type { Participant } from '../core/types';

import { createLogger, errorContext } from '../diagnostics';

const log = createLogger('room:screen-stage');

const SCREEN_UI_IDLE_MS = 1000;
let screenUiIdleTimer = 0;
let screenStagePointerInside = false;
let screenUiHoverBound = false;
let screenAudioFallback: HTMLAudioElement | null = null;
let screenAudioFallbackTrackId = '';

function releaseScreenAudioFallback(): void {
  if (!screenAudioFallback) return;
  screenAudioFallback.pause();
  releaseScreenMediaElement(screenAudioFallback);
  screenAudioFallback.srcObject = null;
  screenAudioFallback.remove();
  screenAudioFallback = null;
  screenAudioFallbackTrackId = '';
}

export function syncScreenAudioFallback(peer: Participant | null, hasVideoStream: boolean): void {
  const audioTrack =
    !hasVideoStream && peer && !peer.isLocal
      ? peer.screenStream?.getAudioTracks().find((track) => track.readyState !== 'ended') || null
      : null;
  if (!audioTrack) {
    releaseScreenAudioFallback();
    return;
  }

  if (!screenAudioFallback || screenAudioFallbackTrackId !== audioTrack.id) {
    releaseScreenAudioFallback();
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.muted = true;
    audio.srcObject = new MediaStream([audioTrack]);
    document.body.append(audio);
    screenAudioFallback = audio;
    screenAudioFallbackTrackId = audioTrack.id;
    audioTrack.addEventListener(
      'ended',
      () => {
        if (screenAudioFallbackTrackId === audioTrack.id) releaseScreenAudioFallback();
      },
      { once: true }
    );
  }

  syncScreenVideoAudio();
}

export function stopScreenAudioFallback(): void {
  releaseScreenAudioFallback();
}

export function refreshScreenMeta(participant: Participant | null): void {
  useScreenUiStore().showMeta = Boolean(participant);
  useScreenUiStore().bumpScreenUiRevision();
}

export function refreshScreenStreamControls(_participant: Participant | null): void {
  useScreenUiStore().bumpScreenUiRevision();
}

export function refreshStageStripControls(): void {
  state.stripCollapsed = false;
  callPageState().$patch({ stripCollapsed: false });
  callPageState().$patch({ stageSummary: 'hidden' });
}

export function syncScreenVideoAudio(): void {
  const video = useScreenUiStore().getScreenVideo();
  if (!video && !screenAudioFallback) return;

  const peer = useScreenUiStore().getActiveScreenPeer();
  const isLocalStream = Boolean(peer?.isLocal);
  const isRemoteStreamActive = Boolean(peer && !peer.isLocal && video?.srcObject);
  const streamVolume = clampStreamVolume(state.screenVolume);
  if (state.screenVolume !== streamVolume) {
    state.screenVolume = normalizeStoredStreamVolume(state.screenVolume);
  }
  const muted = isLocalStream || state.screenMuted || streamVolume <= 0 || isAppPlaybackMuted();
  if (video) {
    applyScreenMediaElementVolume(video, {
      boostAllowed: isRemoteStreamActive,
      muted,
      volume: isLocalStream ? 0 : streamVolume
    });
  }
  if (screenAudioFallback) {
    applyScreenMediaElementVolume(screenAudioFallback, {
      boostAllowed: true,
      muted,
      volume: streamVolume
    });
  }
}

export function toggleScreenMute(): void {
  if (state.screenMuted || state.screenVolume <= 0) {
    state.screenMuted = false;
    if (state.screenVolume <= 0) state.screenVolume = 1;
    state.screenVolume = storeStreamVolume(state.screenVolume, MAX_STREAM_VOLUME);
  } else {
    state.screenMuted = true;
  }
  syncScreenVideoAudio();
}

export function setScreenVolume(percent: number): void {
  state.screenVolume = storeStreamVolume(percent / 100);
  state.screenMuted = state.screenVolume <= 0;
  syncScreenVideoAudio();
}

export async function toggleScreenFullscreen(): Promise<void> {
  const stage = useScreenUiStore().getScreenStage();
  if (!stage) return;

  try {
    if (document.fullscreenElement === stage) {
      await document.exitFullscreen();
      return;
    }

    if (callPageState().desktopScreenFullscreen) {
      await setDesktopScreenFullscreen(false);
      return;
    }

    if (document.fullscreenEnabled) {
      try {
        await stage.requestFullscreen();
        return;
      } catch (error) {
        if (!hasDesktopWindowControls()) throw error;
        log.warn('stage fullscreen unavailable, using desktop window fullscreen', errorContext(error));
      }
    }

    if (hasDesktopWindowControls()) {
      await setDesktopScreenFullscreen(true);
    } else {
      showToast(t('Полноэкранный режим недоступен'));
    }
  } catch (error) {
    log.error('screen stage action failed', errorContext(error));
    showToast(t('Не удалось переключить полноэкранный режим'));
  }
}

function hasDesktopWindowControls(): boolean {
  return Boolean(getInstalledCallPorts()?.platform.desktop.window?.setFullscreen);
}

export async function setDesktopScreenFullscreen(fullscreen: boolean): Promise<void> {
  const stage = useScreenUiStore().getScreenStage();
  const desktopWindow = getInstalledCallPorts()?.platform.desktop.window;
  if (!desktopWindow) throw new Error('Desktop window controls are unavailable.');
  const active = await desktopWindow.setFullscreen(fullscreen);
  if (active) {
    callPageState().$patch({ desktopScreenFullscreen: true });
  } else {
    callPageState().$patch({ desktopScreenFullscreen: false });
  }
  setScreenFullscreenState(active || document.fullscreenElement === stage);
}

export function updateScreenFullscreenState(): void {
  const stage = useScreenUiStore().getScreenStage();
  const fullscreen = Boolean(stage && document.fullscreenElement === stage);
  if (!fullscreen && !callPageState().desktopScreenFullscreen) {
    setScreenFullscreenState(false);
    return;
  }

  setScreenFullscreenState(fullscreen || callPageState().desktopScreenFullscreen);
  if (useScreenUiStore().stageVisible) {
    syncScreenStagePointerState();
  }
}

function setScreenFullscreenState(fullscreen: boolean): void {
  state.screenFullscreen = fullscreen;
  useScreenUiStore().bumpScreenUiRevision();
}

export function bindScreenStageIdleUi(signal?: AbortSignal): void {
  const bound: AddEventListenerOptions = signal ? { signal } : {};
  if (screenUiHoverBound) return;
  screenUiHoverBound = true;
  signal?.addEventListener('abort', resetScreenStageIdleUi, { once: true });

  const stage = useScreenUiStore().getScreenStage();
  if (!stage) return;

  const wakeScreenStageUi = () => {
    if (!screenStagePointerInside || !useScreenUiStore().stageVisible) return;
    activateScreenStageUi();
  };

  stage.addEventListener(
    'pointerenter',
    () => {
      screenStagePointerInside = true;
      activateScreenStageUi();
    },
    bound
  );
  stage.addEventListener(
    'pointerleave',
    () => {
      screenStagePointerInside = false;
      deactivateScreenStageUi();
    },
    bound
  );
  stage.addEventListener('pointermove', wakeScreenStageUi, bound);
  stage.addEventListener('mousedown', wakeScreenStageUi, bound);
  stage.addEventListener('wheel', wakeScreenStageUi, { ...bound, passive: true });
  stage.addEventListener(
    'touchstart',
    () => {
      screenStagePointerInside = true;
      activateScreenStageUi();
    },
    { ...bound, passive: true }
  );
  document.addEventListener(
    'touchstart',
    (event) => {
      if (!useScreenUiStore().stageVisible || !stage) return;
      const target = event.target;
      if (target instanceof Node && stage.contains(target)) {
        screenStagePointerInside = true;
        activateScreenStageUi();
        return;
      }
      screenStagePointerInside = false;
      deactivateScreenStageUi();
    },
    { ...bound, passive: true }
  );
}

function resetScreenStageIdleUi(): void {
  screenUiHoverBound = false;
  screenStagePointerInside = false;
  window.clearTimeout(screenUiIdleTimer);
  useScreenUiStore().uiActive = false;
}

function activateScreenStageUi(): void {
  window.clearTimeout(screenUiIdleTimer);
  useScreenUiStore().uiActive = true;
  if (!screenStagePointerInside) return;

  screenUiIdleTimer = window.setTimeout(() => {
    if (!screenStagePointerInside || !useScreenUiStore().stageVisible) return;
    // A pointer resting on the volume slider or a button is not idle.
    if (document.getElementById('screenViewControls')?.matches(':hover')) {
      activateScreenStageUi();
      return;
    }
    blurFocusedStreamControl();
    useScreenUiStore().uiActive = false;
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
  useScreenUiStore().uiActive = false;
}

export function syncScreenStagePointerState(): void {
  const stage = useScreenUiStore().getScreenStage();
  if (!stage || !useScreenUiStore().stageVisible) return;

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
