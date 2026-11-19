import type { Friend } from '@/api/friends';

export interface FriendMenuTarget {
  friend: Friend;
  anchor: HTMLElement;
  x: number;
  y: number;
}
