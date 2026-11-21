export interface ButtonProps {
  variant?: 'primary' | 'ghost' | 'outline' | 'plain' | 'soft' | 'danger' | 'danger-ghost' | undefined;
  /** Control heights: sm 32, md 40, lg 44, xl 48. */
  size?: 'sm' | 'md' | 'lg' | 'xl' | undefined;
  type?: 'button' | 'submit' | undefined;
  disabled?: boolean | undefined;
  busy?: boolean | undefined;
}
