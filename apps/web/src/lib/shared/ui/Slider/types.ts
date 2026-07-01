import type { Snippet } from 'svelte';

export type SliderProps = {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  snap?: boolean;
  snapThreshold?: number;
  disabled?: boolean;
  /** Hide the default value-proportion fill; use when `background` draws its own (e.g. a live level meter). */
  showFill?: boolean;
  ariaLabel?: string;
  ariaValueText?: string;
  /** Renders inside the track, behind the fill/thumb. Can align to the thumb via `var(--slider-fraction)` / `var(--slider-thumb)`. */
  background?: Snippet;
  onValueChange?: (value: number) => void;
};