// What a test may hand an app instead of the database-backed stores.

import type pg from 'pg';
import type { createRoomStore } from './room-store.ts';
import type { createUserStore } from './user-store.ts';
import type { createFriendStore } from './friend-store.ts';
import type { createNotificationPreferencesRepository } from '../domains/notifications/notification-preferences.repository.ts';
import type { createPushSubscriptionRepository } from '../domains/notifications/push-subscription.repository.ts';
import type { createPushService } from '../lib/push-service.ts';
import type { createAvatarStorage } from '../lib/avatar-storage.ts';
import type { createLiveKitCredentialProvider } from '../domains/admission/livekit-credential-provider.ts';
import type { MembershipModule } from '../domains/membership/membership.module.ts';

/**
 * A stand-in a test supplies for a store: any subset of its methods, each
 * called with the real arguments. What a method answers is the test's to
 * choose, so a case can return just the fields it exercises.
 */
export type Fake<Store> = {
  // Declared as a method so a fake may narrow a parameter the real store
  // accepts loosely (method parameters are checked bivariantly).
  [Key in keyof Store]?: Store[Key] extends (...args: infer Args) => unknown
    ? { method(...args: Args): unknown }['method']
    : unknown;
};

/**
 * The fake, standing where its store goes. This is the test seam's one act of
 * trust: a fake has only what its test reaches, and a call to anything else
 * fails loudly in that test.
 */
export function standIn<Store>(fake: Fake<Store>): Store;
export function standIn(fake: unknown): unknown {
  return fake;
}

/** Stores and services a test supplies instead of the database-backed ones. */
export type StoreOverrides = {
  /** A pool for the database-backed services the test does not fake. */
  pool?: pg.Pool | null;
  store?: Fake<ReturnType<typeof createRoomStore>> | null;
  users?: Fake<ReturnType<typeof createUserStore>> | null;
  friends?: Fake<ReturnType<typeof createFriendStore>> | null;
  notifications?: Fake<ReturnType<typeof createNotificationPreferencesRepository>> | null;
  pushes?: Fake<ReturnType<typeof createPushSubscriptionRepository>> | null;
  push?: Fake<ReturnType<typeof createPushService>> | null;
  avatars?: Fake<ReturnType<typeof createAvatarStorage>> | null;
  liveKitCredentials?: Fake<ReturnType<typeof createLiveKitCredentialProvider>> | null;
  membershipServicesOverride?: { service?: Fake<MembershipModule['service']> } | null;
};
