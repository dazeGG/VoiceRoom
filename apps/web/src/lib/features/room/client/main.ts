import { GATE_THRESHOLD_MIN_DB } from './core/config';
import { roomDeviceUi } from '$lib/features/room/room-device-ui.svelte';
import { startUi } from '$lib/features/room/start-ui.svelte';
import { registerActiveVoiceControls, registerActiveVoiceLeave } from '$lib/features/room/voice-session.svelte';

import { state } from './core/state.svelte';
import { getStoredPeerSession } from './core/session';
import { cleanDisplayName } from './core/utils';
import { showToast } from './ui/toast';
import { handleAudioUnlockGesture } from './services/media-playback-service';
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

export function mountRoomClient(_root: ParentNode = document, options: { roomId?: string; embeddedRoomId?: string; autoJoin?: boolean } = {}): () => void {
  if (mounted) return unmountRoomClient;
  mounted = true;
  mountAbortController = new AbortController();
  const listenerSignal = mountAbortController.signal;
  activeVoiceLeaveTeardown = registerActiveVoiceLeave(leaveRoom);
  activeVoiceControlsTeardown = registerActiveVoiceControls({
    toggleMic: toggleMicrophoneMuted,
    toggleDeafen: toggleOutputMute
  });

  let activePushToTalkCode = '';

  function onVoiceHotkeyDown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return;

    if (state.microphoneMode === 'push-to-talk' && eventMatchesHotkey('push-to-talk', event)) {
      event.preventDefault();
      activePushToTalkCode = event.code;
      if (!event.repeat) beginPushToTalk();
      return;
    }

    if (event.repeat) return;
    if (eventMatchesHotkey('mic-mute', event)) {
      event.preventDefault();
      toggleMicrophoneMuted();
      return;
    }
    if (state.joined && eventMatchesHotkey('output-mute', event)) {
      event.preventDefault();
      toggleOutputMute();
    }
  }

  function onVoiceHotkeyUp(event: KeyboardEvent): void {
    if (!activePushToTalkCode || event.code !== activePushToTalkCode) return;
    event.preventDefault();
    activePushToTalkCode = '';
    endPushToTalk();
  }

  function releasePushToTalkImmediately(): void {
    if (!activePushToTalkCode && !state.pushToTalkActive) return;
    activePushToTalkCode = '';
    endPushToTalk({ immediate: true });
  }

  window.addEventListener('keydown', onVoiceHotkeyDown, { signal: listenerSignal });
  window.addEventListener('keyup', onVoiceHotkeyUp, { signal: listenerSignal });
  window.addEventListener('blur', releasePushToTalkImmediately, { signal: listenerSignal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releasePushToTalkImmediately();
  }, { signal: listenerSignal });

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
  activeVoiceLeaveTeardown?.();
  activeVoiceLeaveTeardown = null;
  activeVoiceControlsTeardown?.();
  activeVoiceControlsTeardown = null;
  mountAbortController?.abort();
  mountAbortController = null;
  resetGuestNameDialog();
  mounted = false;
}
