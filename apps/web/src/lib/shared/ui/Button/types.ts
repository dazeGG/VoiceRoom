import type { Snippet } from 'svelte';

export interface ButtonProps {
  variant?: 'primary' | 'ghost' | 'outline' | 'soft' | 'danger' | 'danger-ghost';
  /** `lg` is 44px, `xl` 50px (landing calls to action). */
  size?: 'md' | 'lg' | 'xl';
  type?: 'button' | 'submit';
  disabled?: boolean;
  class?: string;
  onclick?: (event: MouseEvent) => void;
  icon?: Snippet;
  children?: Snippet;
}
