// Saving a global hotkey. Push-to-talk without a key would leave the microphone
// shut for good, so clearing that key switches the microphone back to open.

import { writeHotkeyBinding, type HotkeyAction } from '$lib/features/room/client/core/hotkeys';
import { setMicrophoneMode } from '$lib/features/room/client/ui/controls';
import type { HotkeyBinding } from '$lib/shared/ui';
import { readSoundSettings } from './sound-settings';

/** Stores the binding; answers true when that switched push-to-talk off. */
export function saveHotkey(action: HotkeyAction, binding: HotkeyBinding | null): boolean {
  writeHotkeyBinding(action, binding);
  if (action !== 'push-to-talk' || binding) return false;
  if (readSoundSettings().microphoneMode !== 'push-to-talk') return false;
  setMicrophoneMode('open');
  return true;
}
