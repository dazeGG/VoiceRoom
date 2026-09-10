import { roomDeviceUi } from '$lib/features/room/room-device-ui.svelte';
import { state } from '../core/state.svelte';
import { postState } from '../room/presence';
import {
  supportsAudioOutputSelection,
  syncPlaybackMuteState,
  unlockAudio
} from '../services/media-playback-service';
import { playMicCue, playOutputCue } from '../media/cues';
import { getLocalMicrophoneCapture, setMicrophoneCaptureEnabled } from '../services/microphone-service';
import { syncLiveKitVoiceSubscriptions, syncLocalMicrophonePublicationMuted } from '../services/livekit-service';
import { getDisplayName } from './names';
import { clearAllSpeaking, updateParticipant } from '../room/participants';
import { persistMicrophoneMode, persistOutputMuted } from '../core/settings';
import { showToast } from './toast';
import { setVoiceControlsState } from '$lib/features/room/voice-session.svelte';
import { PUSH_TO_TALK_RELEASE_HOLD_MS, type MicrophoneMode } from '../core/config';

let pushToTalkReleaseTimer = 0;

/** Mirror the current mic/output mute state to the lobby voice-session store. */
function syncVoiceSessionControls(): void {
  setVoiceControlsState({ muted: state.muted, deafened: state.outputMuted });
}

export interface CallControlsView {
  label: string;
  ariaPressed: boolean;
  disabled: boolean;
  stateName: 'idle' | 'connecting' | 'muted' | 'live' | 'ptt' | 'ptt-active';
}

export interface OutputControlsView {
  label: string;
  ariaPressed: boolean;
  stateName: 'muted' | 'live';
}

export interface ScreenControlsView {
  label: string;
  ariaPressed: boolean;
  disabled: boolean;
  stateName: 'idle' | 'live';
}

export function getCallControlsView(): CallControlsView {
  const label = !state.joined
    ? state.connecting
      ? 'Подключение'
      : 'Подключить микрофон'
    : state.microphoneMode === 'push-to-talk'
      ? state.pushToTalkActive
        ? 'Push-to-talk: микрофон открыт'
        : 'Push-to-talk: микрофон закрыт'
    : state.muted
      ? 'Включить микрофон'
      : 'Выключить микрофон';

  return {
    label,
    ariaPressed: Boolean(state.joined && state.muted),
    disabled: state.connecting,
    stateName: state.connecting
      ? 'connecting'
      : !state.joined
        ? 'idle'
        : state.microphoneMode === 'push-to-talk'
          ? state.pushToTalkActive ? 'ptt-active' : 'ptt'
          : state.muted ? 'muted' : 'live'
  };
}

export function getOutputControlsView(): OutputControlsView {
  const label = state.outputMuted ? 'Включить звук' : 'Выключить звук';
  return {
    label,
    ariaPressed: state.outputMuted,
    stateName: state.outputMuted ? 'muted' : 'live'
  };
}

export function getScreenControlsView(): ScreenControlsView {
  const sharing = Boolean(state.localScreenStream);
  return {
    label: sharing ? 'Закончить стрим' : 'Показать экран',
    ariaPressed: sharing,
    disabled: !state.joined || state.connecting || state.screenStarting,
    stateName: sharing ? 'live' : 'idle'
  };
}

export function syncOutputDeviceUiState(): void {
  roomDeviceUi.outputDisabled = !supportsAudioOutputSelection();
}

export function setMicrophoneMuted(muted: boolean, options: { playCue?: boolean; post?: boolean } = {}): void {
  const {
    playCue = true,
    post = true
  } = options;
  if (!state.localStream) return;
  const nextMuted = Boolean(muted);
  if (state.muted === nextMuted) return;

  if (nextMuted && state.pushToTalkActive) {
    state.pushToTalkActive = false;
    window.clearTimeout(pushToTalkReleaseTimer);
    pushToTalkReleaseTimer = 0;
  }

  state.muted = nextMuted;
  setMicrophoneCaptureEnabled(getLocalMicrophoneCapture(), !state.muted);
  syncLocalMicrophonePublicationMuted().catch((error) => console.warn('LiveKit microphone mute failed', error));

  if (playCue) playMicCue(state.muted);
  updateParticipant({
    deafened: state.outputMuted,
    id: state.peerId,
    muted: state.muted,
    name: getDisplayName()
  });
  syncVoiceSessionControls();
  if (post) postState().catch(() => {});
}

function toggleMute(): void {
  if (state.microphoneMode === 'push-to-talk' && !state.outputMuted) {
    showToast('В режиме Push-to-talk удерживайте назначенную клавишу');
    return;
  }

  // Deafened force-mutes the microphone, so the mic button has nothing to
  // unmute on its own. Rather than refuse, take it as the intent to come back
  // to the conversation and lift the output mute too — the same thing the
  // headphone button would do, which is what people expect from Discord.
  if (state.outputMuted) {
    toggleOutputMute({ unmuteMicrophone: true });
    return;
  }

  setMicrophoneMuted(!state.muted);
}

export function setMicrophoneMode(mode: MicrophoneMode): MicrophoneMode {
  const nextMode = persistMicrophoneMode(mode);
  state.microphoneMode = nextMode;
  resetPushToTalkState();
  if (state.outputMuted) state.micMutedBeforeOutputMute = nextMode === 'push-to-talk';

  if (state.localStream) {
    const shouldMute = nextMode === 'push-to-talk' || state.outputMuted;
    setMicrophoneMuted(shouldMute, { playCue: false });
  }
  return nextMode;
}

export function beginPushToTalk(): boolean {
  if (
    state.microphoneMode !== 'push-to-talk'
    || !state.joined
    || !state.localStream
    || state.outputMuted
  ) return false;

  window.clearTimeout(pushToTalkReleaseTimer);
  pushToTalkReleaseTimer = 0;
  if (state.pushToTalkActive) return true;

  state.pushToTalkActive = true;
  setMicrophoneMuted(false, { playCue: false });
  return true;
}

export function endPushToTalk(options: { immediate?: boolean } = {}): void {
  if (!state.pushToTalkActive) return;
  window.clearTimeout(pushToTalkReleaseTimer);

  const close = () => {
    pushToTalkReleaseTimer = 0;
    state.pushToTalkActive = false;
    setMicrophoneMuted(true, { playCue: false });
  };

  if (options.immediate) {
    close();
    return;
  }

  pushToTalkReleaseTimer = window.setTimeout(close, PUSH_TO_TALK_RELEASE_HOLD_MS);
}

export function resetPushToTalkState(): void {
  window.clearTimeout(pushToTalkReleaseTimer);
  pushToTalkReleaseTimer = 0;
  state.pushToTalkActive = false;
}

export async function handleMicButtonClick(event: Event): Promise<void> {
  if (!state.joined) {
    const { joinRoom } = await import('../room/room');
    await joinRoom(event);
    return;
  }

  toggleMute();
}

/** Toggle the microphone from outside the room UI (e.g. the lobby voice widget). */
export function toggleMicrophoneMuted(): void {
  if (!state.joined) return;
  toggleMute();
}

/**
 * @param options.unmuteMicrophone Undeafening from the microphone button also
 * opens the microphone, regardless of whether it happened to be muted before
 * the output was cut.
 */
export function toggleOutputMute(options: { unmuteMicrophone?: boolean } = {}): void {
  const nextOutputMuted = !state.outputMuted;
  if (nextOutputMuted) {
    state.micMutedBeforeOutputMute = state.muted;
  }

  playOutputCue(nextOutputMuted);
  state.outputMuted = nextOutputMuted;
  persistOutputMuted(state.outputMuted);

  if (state.localStream) {
    if (state.outputMuted) {
      setMicrophoneMuted(true, { playCue: false, post: false });
    } else if (
      state.microphoneMode === 'open'
      && (options.unmuteMicrophone || !state.micMutedBeforeOutputMute)
    ) {
      setMicrophoneMuted(false, { playCue: false, post: false });
    }
  }

  // Rings are cleared on the same tick as the mute so none survives the switch.
  if (state.outputMuted) clearAllSpeaking();

  syncOutputDeviceUiState();
  syncLiveKitVoiceSubscriptions();
  syncPlaybackMuteState({ muteDelayMs: nextOutputMuted ? 220 : 0 });
  updateParticipant({
    deafened: state.outputMuted,
    id: state.peerId,
    muted: state.muted,
    name: getDisplayName()
  });
  syncVoiceSessionControls();
  postState().catch(() => {});
  if (!state.outputMuted) unlockAudio().catch(() => {});
}

/** @deprecated Reactive views replace imperative DOM refresh. */
export function refreshOutputControls(): void {
  syncOutputDeviceUiState();
}

/** @deprecated Reactive views replace imperative DOM refresh. */
export function refreshCallControls(): void {}
