import type { Snippet } from 'svelte';

export interface BadgeProps {
  tone?: 'default' | 'muted' | 'warning';
  class?: string;
  children?: Snippet;
}
