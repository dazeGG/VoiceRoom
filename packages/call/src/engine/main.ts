import { setCallPeerTakesRed } from './services/livekit/local-publications';
import { getCallPorts } from './ports';
import { t } from '@voiceroom/ui-kit/i18n';
import { GATE_THRESHOLD_MIN_DB } from './core/config';
import { useRoomDeviceUiStore } from './core/room-device-ui.store';
import { useStartUiStore } from './core/start-ui.store';
import { useVoiceSessionStore } from './core/voice-session.store';

import { hydrateRoomPreferences, state } from './core/room-runtime.store';
import { resetRoomShell, setRoomEmbedded, setRoomShell, type CallShell } from './core/embed';
import { cleanDisplayName } from './core/utils';
import { showToast } from './ui/toast';
import { handleAudioUnlockGesture } from './services/media-playback-service';
import {
  bindDesktopGlobalHotkeys,
  isDesktopGlobalHotkeyRegistered,
  syncDesktopGlobalHotkeys,
  type DesktopHotkeyRegistrationResult
} from './services/desktop-hotkey-service';
import { handleDeviceChange, refreshMicrophoneLevelMeter } from './ui/devices';
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
  showRoomScreen,
  showStartScreen
} from './room/room';
import { rememberRoomStatus } from './net/api';
import {
  bindScreenStageIdleUi,
  refreshStageStripControls,
  syncScreenVideoAudio,
  updateScreenFullscreenState
} from './ui/screen-view';

import { createLogger, errorContext, reportClientLogs } from './diagnostics';
import { DISPLAY_NAME_STORAGE_KEY, readStorage } from './core/storage';
import type { PeerSession } from './core/types';

const log = createLogger('room');

let mounted = false;
let mountAbortController: AbortController | null = null;
let activeVoiceLeaveTeardown: (() => void) | null = null;
let activeVoiceControlsTeardown: (() => void) | null = null;
let desktopHotkeysTeardown: (() => void) | null = null;

/** A guest host has already checked the room and collected the name. */
export function mountGuestRoomClient(roomId: string, displayName: string, checkedAt: number): () => void {
  return mountRoomClient(document, { roomId, guestEntry: { displayName, checkedAt } });
}

export function mountRoomClient(
  _root: ParentNode = document,
  options: {
    roomId?: string;
    roomRoute?: boolean;
    missingRoomLabel?: string;
    embedded?: boolean;
    shell?: CallShell;
    autoJoin?: boolean;
    guestEntry?: { displayName: string; checkedAt: number };
    friendCall?: {
      callId: string;
      /** The caller starts the call's E2EE key agreement and the callee answers it. */
      initiator: boolean;
      session: PeerSession;
      name: string;
      onMissingMicrophone: () => void;
      onJoinFailed: () => void;
    };
  } = {}
): () => void {
  const ports = getCallPorts();
  if (!ports.platform.policy().roomClientAllowed) return () => {};
  if (mounted) return unmountRoomClient;
  mounted = true;
  // The room is where the failures that matter happen, so the capture starts
  // with it rather than globally at app boot.
  ports.diagnostics.installGlobalErrorCapture();
  hydrateRoomPreferences();
  setRoomEmbedded(options.embedded ?? false);
  if (options.shell) setRoomShell(options.shell);
  mountAbortController = new AbortController();
  const listenerSignal = mountAbortController.signal;
  activeVoiceLeaveTeardown = useVoiceSessionStore().registerActiveVoiceLeave(leaveRoom);
  activeVoiceControlsTeardown = useVoiceSessionStore().registerActiveVoiceControls({
    toggleMic: toggleMicrophoneMuted,
    toggleDeafen: () => toggleOutputMute()
  });
  const desktopRuntime = Boolean(ports.platform.desktop.runtime?.isDesktop);
  let lastDesktopHotkeyFailure = '';
  desktopHotkeysTeardown = desktopRuntime
    ? bindDesktopGlobalHotkeys(
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
          const labels = [
            ...new Set(
              result.failed.map(({ action }) =>
                action === 'mic-mute'
                  ? t('мьют микрофона')
                  : action === 'output-mute'
                    ? t('мьют звука')
                    : 'push-to-talk'
              )
            )
          ];
          const reasons = new Set(result.failed.map(({ reason }) => reason));
          const explanation = reasons.has('modifier-required')
            ? t('Для букв и цифр добавьте Ctrl, ⌘, Alt или Shift.')
            : reasons.has('input-monitoring-required')
              ? t('Разрешите VoiceRoom «Мониторинг ввода» в системных настройках macOS и переподключитесь к голосу.')
              : reasons.has('duplicate-binding')
                ? t('Назначьте действиям разные сочетания.')
                : reasons.has('unsupported-key')
                  ? t('Выберите другую клавишу.')
                  : [...reasons].some((reason) => reason.startsWith('helper-') || reason === 'platform-unsupported')
                    ? t('Native-компонент системных клавиш недоступен.')
                    : t('Возможно, сочетание занято другим приложением.');
          showToast(t('Системное сочетание недоступно: {p0}. {p1}', { p0: labels.join(', '), p1: explanation }));
        }
      )
    : null;

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
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) releasePushToTalkImmediately();
      },
      { signal: listenerSignal }
    );
  }

  const mountedRoomId = options.roomId ?? '';
  const friendCall = options.friendCall;
  state.callId = friendCall?.callId;
  state.callE2eeInitiator = friendCall?.initiator ?? false;
  state.callE2ee = null;
  setCallPeerTakesRed(null);
  state.roomRoute = options.roomRoute ?? Boolean(mountedRoomId);
  state.missingRoomLabel = options.missingRoomLabel ?? '';
  if (mountedRoomId) {
    const peerSession = friendCall?.session ?? ports.identity.credentials(mountedRoomId);
    state.connecting = false;
    state.joined = false;
    state.voiceRealtimeTeardown?.();
    state.voiceRealtimeTeardown = null;
    state.peers.clear();
    state.serverPeerIds.clear();
    state.serverPeerSyncReady = false;
    state.self = null;
    state.roomName = friendCall?.name ?? '';
    state.roomAvatarUrl = '';
    state.roomIsStatic = false;
    state.roomId = mountedRoomId;

    state.peerId = peerSession.peerId;
    state.sessionToken = peerSession.sessionToken;
  } else {
    state.roomId = '';
    state.peerId = '';
    state.sessionToken = '';
  }

  const savedName =
    (friendCall && ports.identity.current().profile?.displayName) ??
    options.guestEntry?.displayName ??
    cleanDisplayName(readStorage(DISPLAY_NAME_STORAGE_KEY));
  state.savedName = savedName;
  useStartUiStore().nameInput = savedName;
  updateNameStatuses(savedName);
  useRoomDeviceUiStore().noiseMode = state.noiseMode;
  useRoomDeviceUiStore().microphoneVolume = state.microphoneVolume;
  refreshMicrophoneLevelMeter(GATE_THRESHOLD_MIN_DB);

  syncScreenVideoAudio();
  bindScreenStageIdleUi(listenerSignal);

  document.addEventListener('pointerdown', handleAudioUnlockGesture, { passive: true, signal: listenerSignal });
  document.addEventListener('keydown', handleAudioUnlockGesture, { signal: listenerSignal });
  document.addEventListener('fullscreenchange', updateScreenFullscreenState, { signal: listenerSignal });
  navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange, { signal: listenerSignal });
  // pagehide, not beforeunload: a click on a file download (the desktop app's
  // installer) fires beforeunload too, yet the page stays and so must the call.
  window.addEventListener('pagehide', leaveRoom, { signal: listenerSignal });
  syncOutputDeviceUiState();
  refreshStageStripControls();

  function runRoomRoute(): void {
    showRoomRoute()
      .then((ready) => {
        if (ready && options.autoJoin) return joinRoom();
      })
      .catch((error: unknown) => {
        log.error('room client failed', errorContext(error));
        // The user is now looking at a failure screen; send what led to it
        // while the buffer still holds the device and connection records.
        void reportClientLogs('room client failed to start');
        showRoomEntryFailure();
        showToast(t('Не удалось проверить комнату'));
      });
  }

  if (state.roomRoute && !state.roomId) {
    showRoomNotFound();
  } else if (state.roomId) {
    if (friendCall) {
      // The signed-in action admitted this seat. It has no public room status or preview.
      void joinRoom(undefined, friendCall.onMissingMicrophone).then(() => {
        if (!listenerSignal.aborted && !state.joined) friendCall.onJoinFailed();
      });
    } else if (options.guestEntry) {
      rememberRoomStatus(state.roomId, { name: '', avatarUrl: null, isStatic: false }, options.guestEntry.checkedAt);
      showRoomScreen();
    } else {
      runRoomRoute();
    }
  } else {
    showStartScreen();
  }

  return unmountRoomClient;
}

function unmountRoomClient(): void {
  leaveRoom();
  state.callId = undefined;
  state.callE2eeInitiator = false;
  state.callE2ee = null;
  setCallPeerTakesRed(null);
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
  resetRoomShell();
  mounted = false;
}
