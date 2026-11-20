import type { HotkeyBinding } from '@voice-room/ui/hotkey';

export type { HotkeyBinding } from '@voice-room/ui/hotkey';

/**
 * Props of HotkeyRecorder. The binding itself is `v-model` (`HotkeyBinding | null`);
 * the component emits `recordingChange(recording: boolean)` when recording starts
 * or stops, and `valueChange(value: HotkeyBinding | null)` after a recorded or reset binding.
 */
export interface HotkeyRecorderProps {
  ariaLabel?: string;
  defaultValue?: HotkeyBinding | null;
  disabled?: boolean;
}
