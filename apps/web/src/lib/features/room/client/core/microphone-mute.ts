import { state } from './state.svelte';

/**
 * Whether the room should see this microphone as muted.
 *
 * Push-to-talk keeps the capture closed while the key is up, but that is how the
 * mode works, not a mute: nobody sees a mute icon, and the tile lights up while
 * the key is held. Deafen still shows as muted, because it force-mutes the
 * microphone in every mode.
 */
export function isMicrophoneShownMuted(): boolean {
  if (!state.muted) return false;
  return state.microphoneMode !== 'push-to-talk' || state.outputMuted;
}
