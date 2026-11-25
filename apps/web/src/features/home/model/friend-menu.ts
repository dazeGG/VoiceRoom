import type { Friend } from '@/api/friends';
import { useCallEntry } from '@/features/friend-call/use-call-entry';

export interface FriendMenuTarget {
  friend: Friend;
  anchor: HTMLElement;
  x: number;
  y: number;
}

export const useFriendMenuCall = (target: () => FriendMenuTarget | null) =>
  useCallEntry(
    () => target()?.friend.user.id,
    () => target()?.friend.online ?? false
  );
