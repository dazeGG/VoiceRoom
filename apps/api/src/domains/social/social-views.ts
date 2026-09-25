// How people appear to each other outside a room: the actor on a
// notification, and whether an account can still be written to or invited.

import type { NotificationActor } from '@voice-room/shared/contracts/realtime';
import { publicUser, type StoredUser } from '../../lib/user-store.ts';

export type SocialUser = StoredUser;

export function notificationActor(user: SocialUser): NotificationActor;
export function notificationActor(user: SocialUser | null | undefined): NotificationActor | null;
export function notificationActor(user: SocialUser | null | undefined): NotificationActor | null {
  const actor = publicUser(user);
  if (!actor) return null;
  return {
    id: actor.id,
    displayName: actor.displayName,
    login: actor.login,
    avatarAccent: actor.avatarAccent,
    avatarColorKey: actor.avatarColorKey,
    avatarUrl: actor.avatarUrl
  };
}

/** Accounts waiting to be deleted, and deleted ones, can no longer be written to or invited. */
export function isActiveAccount(user: SocialUser | null | undefined): boolean {
  return Boolean(user && !user.deletionRequestedAt && !user.deletedAt);
}
