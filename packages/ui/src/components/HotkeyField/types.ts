import type { HotkeyBinding } from '../../hotkey';

/**
 * Props of HotkeyField. The binding itself is `v-model` (`HotkeyBinding | null`);
 * the component emits `recordingChange(recording: boolean)` when recording starts
 * or stops, and `valueChange(value: HotkeyBinding | null)` after a recorded or reset binding.
 */
export interface HotkeyFieldProps {
  ariaLabel?: string;
  defaultValue?: HotkeyBinding | null;
  disabled?: boolean;
}
