import type { Snippet } from 'svelte';

export interface ButtonProps {
  variant?: 'primary' | 'ghost' | 'outline' | 'soft' | 'danger' | 'danger-ghost' | undefined;
  /** `lg` is 44px, `xl` 50px (landing calls to action). */
  size?: 'md' | 'lg' | 'xl' | undefined;
  type?: 'button' | 'submit' | undefined;
  disabled?: boolean | undefined;
  class?: string | undefined;
  onclick?: ((event: MouseEvent) => void) | undefined;
  icon?: Snippet | undefined;
  children?: Snippet | undefined;
}
