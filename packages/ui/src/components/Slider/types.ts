export type SliderProps = {
  min?: number;
  max?: number;
  step?: number;
  orientation?: 'horizontal' | 'vertical';
  defaultValue?: number;
  snap?: boolean;
  snapThreshold?: number;
  disabled?: boolean;
  /** Hide the default value-proportion fill; use when the `background` slot draws its own (e.g. a live level meter). */
  showFill?: boolean;
  ariaLabel?: string;
  ariaValueText?: string;
};
