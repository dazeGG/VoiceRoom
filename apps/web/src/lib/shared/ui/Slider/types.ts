export type SliderProps = {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  snap?: boolean;
  snapThreshold?: number;
  disabled?: boolean;
  ariaLabel?: string;
  ariaValueText?: string;
  onValueChange?: (value: number) => void;
};