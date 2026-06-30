import { roomDeviceUi } from '$lib/features/room/room-device-ui.svelte';
import { elements } from './dom';
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
  elements.muteButton.setAttribute('aria-pressed', String(state.muted));
  refreshCallControls();
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

  refreshOutputControls();
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

export function refreshOutputControls(): void {
  const label = state.outputMuted ? 'Включить звук' : 'Выключить звук';
  elements.outputText.textContent = label;
  elements.outputButton.setAttribute('aria-label', label);
  elements.outputButton.setAttribute('aria-pressed', String(state.outputMuted));
  elements.outputButton.dataset.state = state.outputMuted ? 'muted' : 'live';
  roomDeviceUi.outputDisabled = !supportsAudioOutputSelection();
}

export function refreshCallControls(): void {
  const label = !state.joined
    ? state.connecting
      ? 'Подключение'
      : 'Подключить микрофон'
    : state.muted
      ? 'Включить микрофон'
      : 'Выключить микрофон';

  elements.muteText.textContent = label;
  elements.muteButton.setAttribute('aria-label', label);
  elements.muteButton.setAttribute('aria-pressed', String(state.joined && state.muted));
  elements.muteButton.dataset.state = state.connecting ? 'connecting' : !state.joined ? 'idle' : state.muted ? 'muted' : 'live';
}
