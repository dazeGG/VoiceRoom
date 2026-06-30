import type { Snippet } from 'svelte';

export type VolumeSliderProps = {
  /** Current value, in the same units as the scale (default range 0–200). */
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  /** Value the slider magnetizes to while dragging (also the middle scale tick). */
  defaultValue?: number;
  /** Snap to `defaultValue` when a pointer drag lands within `snapThreshold`. */
  snap?: boolean;
  snapThreshold?: number;
  /** Header label; when empty the header row is hidden. */
  label?: string;
  /** Show the live percentage readout in the header. */
  showValue?: boolean;
  /** Render the 0 / default / max scale ticks beneath the track. */
  showScale?: boolean;
  disabled?: boolean;
  /** Accessible name for the native range input (falls back to `label`). */
  ariaLabel?: string;
  /** Override the leading header icon. */
  icon?: Snippet;
  onValueChange?: (value: number) => void;
};
