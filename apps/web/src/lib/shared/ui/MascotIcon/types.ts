export type MascotVariant = 'blink' | 'look' | 'scare';

export interface MascotIconProps {
  variant?: MascotVariant;
  size?: number;
  class?: string;
}
