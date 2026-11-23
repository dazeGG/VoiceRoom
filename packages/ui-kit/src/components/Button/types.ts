export interface ButtonProps {
  variant?: 'primary' | 'ghost' | 'outline' | 'plain' | 'soft' | 'danger' | 'danger-ghost' | undefined;
  /** Control heights: xs 28, sm 32, md 40, lg 44, xl 48. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'inline' | undefined;
  type?: 'button' | 'submit' | undefined;
  href?: string;
  to?: string;
  disabled?: boolean | undefined;
  scrim?: boolean;
  pill?: boolean;
  layout?: 'center' | 'start' | 'spaced';
  wrap?: boolean;
  fill?: boolean;
  busy?: boolean | undefined;
}
