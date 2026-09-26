// What a test may hand an app instead of the database-backed stores.

import type pg from 'pg';
import type { createRoomStore } from '../lib/room-store.ts';
import type { createUserStore } from '../lib/user-store.ts';
import type { createFriendStore } from '../lib/friend-store.ts';
import type { createNotificationStore } from '../lib/notification-store.ts';
import type { createPushStore } from '../lib/push-store.ts';
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

/** Stores and services a test supplies instead of the database-backed ones. */
export type StoreOverrides = {
  /** A pool for the database-backed services the test does not fake. */
  pool?: pg.Pool | null;
  store?: Fake<ReturnType<typeof createRoomStore>> | null;
  users?: Fake<ReturnType<typeof createUserStore>> | null;
  friends?: Fake<ReturnType<typeof createFriendStore>> | null;
  notifications?: Fake<ReturnType<typeof createNotificationStore>> | null;
  pushes?: Fake<ReturnType<typeof createPushStore>> | null;
  push?: Fake<ReturnType<typeof createPushService>> | null;
  avatars?: Fake<ReturnType<typeof createAvatarStorage>> | null;
  liveKitCredentials?: Fake<ReturnType<typeof createLiveKitCredentialProvider>> | null;
  membershipServicesOverride?: { service?: Fake<MembershipModule['service']> } | null;
};
