import type { Snippet } from 'svelte';

export interface AvatarStackItem {
  id: string;
  label: string;
  initials: string;
  background: string;
  foreground?: string;
  shadow?: string;
}

export interface AvatarStackProps {
  items: AvatarStackItem[];
  maxAvatars?: number | null;
  size?: number;
  ariaLabel?: string;
  class?: string;
  empty?: Snippet;
}
