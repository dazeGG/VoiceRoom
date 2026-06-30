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
import { updateParticipant } from '../room/participants';
import { persistOutputMuted } from './devices';
import { joinRoom } from '../room/room';
import { showToast } from './toast';

export interface CallControlsView {
  label: string;
  ariaPressed: boolean;
  stateName: 'idle' | 'connecting' | 'muted' | 'live';
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
    : state.muted
      ? 'Включить микрофон'
      : 'Выключить микрофон';

  return {
    label,
    ariaPressed: Boolean(state.joined && state.muted),
    stateName: state.connecting ? 'connecting' : !state.joined ? 'idle' : state.muted ? 'muted' : 'live'
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
  if (post) postState().catch(() => {});
}

function toggleMute(): void {
  if (state.outputMuted && state.muted) {
    showToast('Сначала включите звук');
    return;
  }

  setMicrophoneMuted(!state.muted);
}

export async function handleMicButtonClick(event: Event): Promise<void> {
  if (!state.joined) {
    await joinRoom(event);
    return;
  }

  toggleMute();
}

export function toggleOutputMute(): void {
  const nextOutputMuted = !state.outputMuted;
  if (nextOutputMuted) {
    state.micMutedBeforeOutputMute = state.muted;
  }

  playOutputCue(nextOutputMuted);
  state.outputMuted = nextOutputMuted;
  persistOutputMuted();

  if (state.localStream) {
    if (state.outputMuted) {
      setMicrophoneMuted(true, { playCue: false, post: false });
    } else if (!state.micMutedBeforeOutputMute) {
      setMicrophoneMuted(false, { playCue: false, post: false });
    }
  }

  syncOutputDeviceUiState();
  syncLiveKitVoiceSubscriptions();
  syncPlaybackMuteState();
  updateParticipant({
    deafened: state.outputMuted,
    id: state.peerId,
    muted: state.muted,
    name: getDisplayName()
  });
  postState().catch(() => {});
  if (!state.outputMuted) unlockAudio().catch(() => {});
}

/** @deprecated Reactive views replace imperative DOM refresh. */
export function refreshOutputControls(): void {
  syncOutputDeviceUiState();
}

/** @deprecated Reactive views replace imperative DOM refresh. */
export function refreshCallControls(): void {}