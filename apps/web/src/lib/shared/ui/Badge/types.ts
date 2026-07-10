import type { Snippet } from 'svelte';

export interface BadgeProps {
  tone?: 'default' | 'warning';
  class?: string;
  children?: Snippet;
}
