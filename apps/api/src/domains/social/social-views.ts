// How people appear to each other outside a room: the actor on a
// notification, and whether an account can still be written to or invited.

import { publicUser } from '../../lib/user-store.ts';

export interface SocialUser {
  id: string;
  login?: string;
  displayName?: string;
  deletionRequestedAt?: number | null;
  deletedAt?: number | null;
  [key: string]: unknown;
}

export function notificationActor(user: SocialUser | null | undefined) {
  const actor = publicUser(user) as Record<string, unknown> | null;
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
