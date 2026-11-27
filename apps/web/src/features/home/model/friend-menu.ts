import type { Friend } from '@/api/friends';
import { useCallEntry } from '@/features/friend-call/use-call-entry';

export interface FriendMenuTarget {
  friend: Pick<Friend, 'user' | 'online'>;
  muted?: boolean;
  anchor: HTMLElement;
  x: number;
  y: number;
}

export const useFriendMenuCall = (target: () => FriendMenuTarget | null) =>
  useCallEntry(
    () => target()?.friend.user.id,
    () => target()?.friend.online ?? false
  );

export function friendMenuTarget(
  event: MouseEvent | KeyboardEvent,
  friend: FriendMenuTarget['friend'],
  muted = false
): FriendMenuTarget | null {
  if (event instanceof KeyboardEvent && event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
    return null;
  }
  const anchor = event.currentTarget;
  if (!(anchor instanceof HTMLElement)) return null;
  event.preventDefault();
  event.stopPropagation();
  const rect = anchor.getBoundingClientRect();
  const pointer = event instanceof MouseEvent && event.type === 'contextmenu' && (event.clientX || event.clientY);
  return { friend, muted, anchor, x: pointer ? event.clientX : rect.left, y: pointer ? event.clientY : rect.bottom };
}
