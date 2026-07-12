export { default as HotkeyRecorder } from './HotkeyRecorder.svelte';
export {
  formatHotkeyBinding,
  hotkeyBindingFromEvent,
  hotkeyMatchesEvent,
  isHotkeyModifierCode
} from './hotkey.js';
export type { HotkeyBinding, HotkeyRecorderProps } from './types';
