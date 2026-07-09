import type { Snippet } from 'svelte';

export interface ButtonProps {
  variant?: 'primary' | 'ghost';
  type?: 'button' | 'submit';
  disabled?: boolean;
  class?: string;
  onclick?: (event: MouseEvent) => void;
  icon?: Snippet;
  children?: Snippet;
}
