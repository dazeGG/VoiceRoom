import { GATE_THRESHOLD_MIN_DB } from './core/config';
import { roomDeviceUi } from '$lib/features/room/room-device-ui.svelte';
import { startUi } from '$lib/features/room/start-ui.svelte';
import { registerActiveVoiceControls, registerActiveVoiceLeave } from '$lib/features/room/voice-session.svelte';
import { isDesktopBoundaryAllowed } from '$lib/platform/desktop-boundary';

import { state } from './core/state.svelte';
import { getStoredPeerSession } from './core/session';
import { cleanDisplayName } from './core/utils';
import { showToast } from './ui/toast';
import { handleAudioUnlockGesture } from './services/media-playback-service';
import {
  bindDesktopGlobalHotkeys,
  isDesktopGlobalHotkeyRegistered,
  syncDesktopGlobalHotkeys,
  type DesktopHotkeyRegistrationResult
} from './services/desktop-hotkey-service';
import { refreshDevices, refreshMicrophoneLevelMeter } from './ui/devices';
import {
  beginPushToTalk,
  endPushToTalk,
  syncOutputDeviceUiState,
  toggleMicrophoneMuted,
  toggleOutputMute
} from './ui/controls';
import { eventMatchesHotkey, isTypingTarget } from './core/hotkeys';
import { resetGuestNameDialog, updateNameStatuses } from './ui/names';
import { resetRoomMusic } from '$lib/features/room/room-music.svelte';
import {
  joinRoom,
  leaveRoom,
  showRoomEntryFailure,
  showRoomNotFound,
  showRoomRoute,
  showStartScreen
} from './room/room';
import {
  bindScreenStageIdleUi,
  refreshStageStripControls,
  syncScreenVideoAudio,
  updateScreenFullscreenState
} from './ui/screen-view';
import { closeScreenSourceOnEscape } from './ui/screen-source-picker';


let mounted = false;
let mountAbortController: AbortController | null = null;
let activeVoiceLeaveTeardown: (() => void) | null = null;
let activeVoiceControlsTeardown: (() => void) | null = null;
let desktopHotkeysTeardown: (() => void) | null = null;

export function mountRoomClient(_root: ParentNode = document, options: { roomId?: string; embeddedRoomId?: string; autoJoin?: boolean } = {}): () => void {
  if (!isDesktopBoundaryAllowed()) return () => {};
  if (mounted) return unmountRoomClient;
  mounted = true;
  mountAbortController = new AbortController();
  const listenerSignal = mountAbortController.signal;
  activeVoiceLeaveTeardown = registerActiveVoiceLeave(leaveRoom);
  activeVoiceControlsTeardown = registerActiveVoiceControls({
    toggleMic: toggleMicrophoneMuted,
    toggleDeafen: toggleOutputMute
  });
  const desktopRuntime = Boolean(window.voiceRoomRuntime?.isDesktop);
  let lastDesktopHotkeyFailure = '';
  desktopHotkeysTeardown = desktopRuntime ? bindDesktopGlobalHotkeys(
    (action, phase, options) => {
      if (!state.joined) return;
      if (action === 'push-to-talk') {
        if (phase === 'pressed') beginPushToTalk();
        else endPushToTalk({ immediate: options?.immediate });
        return;
      }
      if (phase !== 'pressed') return;
      if (action === 'mic-mute') toggleMicrophoneMuted();
      if (action === 'output-mute') toggleOutputMute();
    },
    (result: DesktopHotkeyRegistrationResult) => {
      if (!state.joined || result.failed.length === 0) {
        lastDesktopHotkeyFailure = '';
        return;
      }

      const failureKey = result.failed.map(({ action, reason }) => `${action}:${reason}`).join('|');
      if (failureKey === lastDesktopHotkeyFailure) return;
      lastDesktopHotkeyFailure = failureKey;
      const labels = [...new Set(result.failed.map(({ action }) => action === 'mic-mute'
        ? 'мьют микрофона'
        : action === 'output-mute'
          ? 'мьют звука'
          : 'push-to-talk'))];
      const reasons = new Set(result.failed.map(({ reason }) => reason));
      const explanation = reasons.has('modifier-required')
        ? 'Для букв и цифр добавьте Ctrl, ⌘, Alt или Shift.'
        : reasons.has('input-monitoring-required')
          ? 'Разрешите Voice Room «Мониторинг ввода» в системных настройках macOS и переподключитесь к голосу.'
        : reasons.has('duplicate-binding')
          ? 'Назначьте действиям разные сочетания.'
          : reasons.has('unsupported-key')
            ? 'Выберите другую клавишу.'
            : [...reasons].some((reason) => reason.startsWith('helper-') || reason === 'platform-unsupported')
              ? 'Native-компонент системных клавиш недоступен.'
            : 'Возможно, сочетание занято другим приложением.';
      showToast(`Системное сочетание недоступно: ${labels.join(', ')}. ${explanation}`);
    }
  ) : null;

  let activePushToTalkCode = '';
  let localPushToTalkOwned = false;

  function onVoiceHotkeyDown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return;

    if (state.microphoneMode === 'push-to-talk' && eventMatchesHotkey('push-to-talk', event)) {
      event.preventDefault();
      if (isDesktopGlobalHotkeyRegistered('push-to-talk')) return;
      if (!event.repeat) {
        localPushToTalkOwned = beginPushToTalk();
        activePushToTalkCode = localPushToTalkOwned ? event.code : '';
      }
      return;
    }

    if (event.repeat) return;
    if (eventMatchesHotkey('mic-mute', event)) {
      event.preventDefault();
      if (isDesktopGlobalHotkeyRegistered('mic-mute')) return;
      toggleMicrophoneMuted();
      return;
    }
    if (state.joined && eventMatchesHotkey('output-mute', event)) {
      event.preventDefault();
      if (isDesktopGlobalHotkeyRegistered('output-mute')) return;
      toggleOutputMute();
    }
  }

  function onVoiceHotkeyUp(event: KeyboardEvent): void {
    if (!localPushToTalkOwned || !activePushToTalkCode || event.code !== activePushToTalkCode) return;
    event.preventDefault();
    activePushToTalkCode = '';
    localPushToTalkOwned = false;
    endPushToTalk();
  }

  function releasePushToTalkImmediately(): void {
    if (!localPushToTalkOwned) return;
    activePushToTalkCode = '';
    localPushToTalkOwned = false;
    endPushToTalk({ immediate: true });
  }

  if (desktopRuntime) {
    window.addEventListener('keydown', onVoiceHotkeyDown, { signal: listenerSignal });
    window.addEventListener('keyup', onVoiceHotkeyUp, { signal: listenerSignal });
    window.addEventListener('blur', releasePushToTalkImmediately, { signal: listenerSignal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releasePushToTalkImmediately();
    }, { signal: listenerSignal });
  }

  const mountedRoomId = options.roomId || options.embeddedRoomId || '';
  if (mountedRoomId) {
    const peerSession = getStoredPeerSession(mountedRoomId);
    state.connecting = false;
    state.joined = false;
    state.voiceRealtimeTeardown?.();
    state.voiceRealtimeTeardown = null;
    state.peers.clear();
    state.serverPeerIds.clear();
    state.serverPeerSyncReady = false;
    resetRoomMusic();
    state.self = null;
    state.roomName = '';
    state.roomAvatarUrl = '';
    state.roomId = mountedRoomId;
    state.roomRoute = true;
    state.peerId = peerSession.peerId;
    state.sessionToken = peerSession.sessionToken;
  }

  const savedName = cleanDisplayName(localStorage.getItem('voice-room:name'));
  state.savedName = savedName;
  startUi.nameInput = savedName;
  updateNameStatuses(savedName);
  roomDeviceUi.noiseMode = state.noiseMode;
  roomDeviceUi.microphoneVolume = state.microphoneVolume;
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);

  syncScreenVideoAudio();
  bindScreenStageIdleUi(listenerSignal);

  document.addEventListener('keydown', closeScreenSourceOnEscape, { signal: listenerSignal });
  document.addEventListener('pointerdown', handleAudioUnlockGesture, { passive: true, signal: listenerSignal });
  document.addEventListener('keydown', handleAudioUnlockGesture, { signal: listenerSignal });
  document.addEventListener('fullscreenchange', updateScreenFullscreenState, { signal: listenerSignal });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshDevices().catch(() => {}), { signal: listenerSignal });
  window.addEventListener('beforeunload', leaveRoom, { signal: listenerSignal });
  syncOutputDeviceUiState();
  refreshStageStripControls();

  function runRoomRoute(): void {
    showRoomRoute()
      .then((ready) => {
        if (ready && options.autoJoin) return joinRoom();
      })
      .catch((error) => {
        console.error(error);
        showRoomEntryFailure();
        showToast('Не удалось проверить комнату');
      });
  }

  if (state.roomRoute && !state.roomId) {
    showRoomNotFound();
  } else if (state.roomId) {
    runRoomRoute();
  } else {
    showStartScreen();
  }

  return unmountRoomClient;
}

function unmountRoomClient(): void {
  leaveRoom();
  void syncDesktopGlobalHotkeys(false);
  desktopHotkeysTeardown?.();
  desktopHotkeysTeardown = null;
  activeVoiceLeaveTeardown?.();
  activeVoiceLeaveTeardown = null;
  activeVoiceControlsTeardown?.();
  activeVoiceControlsTeardown = null;
  mountAbortController?.abort();
  mountAbortController = null;
  resetGuestNameDialog();
  mounted = false;
}
