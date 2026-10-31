// Saving a global hotkey. Push-to-talk without a key would leave the microphone
// shut for good, so clearing that key switches the microphone back to open.

import { setMicrophoneMode, writeHotkeyBinding, type HotkeyAction } from '@/features/room/client';
import type { HotkeyBinding } from '@/shared/ui/HotkeyRecorder/types';
import { readSoundSettings } from './sound-settings';

/** Stores the binding; answers true when that switched push-to-talk off. */
export function saveHotkey(action: HotkeyAction, binding: HotkeyBinding | null): boolean {
  writeHotkeyBinding(action, binding);
  if (action !== 'push-to-talk' || binding) return false;
  if (readSoundSettings().microphoneMode !== 'push-to-talk') return false;
  setMicrophoneMode('open');
  return true;
}
