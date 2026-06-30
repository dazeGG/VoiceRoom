import type { Snippet } from 'svelte';

export type EllipsisProps = {
  text?: string;
  title?: string;
  class?: string;
  inline?: boolean;
  tag?: keyof HTMLElementTagNameMap;
  children?: Snippet;
};
