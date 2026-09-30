// Notification settings (mutes, privacy, do-not-disturb, presence status),
// web push subscriptions, and the mention/reply inbox.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';
import { PresenceStatus } from './users.ts';

export const NotificationLevel = Type.Union([Type.Literal('all'), Type.Literal('mentions'), Type.Literal('none')]);
export type NotificationLevel = Static<typeof NotificationLevel>;

export const NotificationPreferences = Type.Object({
  doNotDisturb: Type.Boolean(),
  mutedPeerIds: Type.Array(Type.String()),
  mutedRoomIds: Type.Array(Type.String()),
  roomLevels: Type.Record(Type.String(), NotificationLevel),
  presenceStatus: PresenceStatus,
  /** Set by idle detection rather than chosen: only ever 'away'. */
  presenceStatusAutomatic: Type.Boolean(),
  privateNotifications: Type.Boolean()
});
export type NotificationPreferences = Static<typeof NotificationPreferences>;

export const Preferences = Ok({ preferences: NotificationPreferences });
export type Preferences = Static<typeof Preferences>;

export const MuteBody = Type.Object({ muted: Type.Optional(Type.Boolean()) });
export const Muted = Ok({ muted: Type.Boolean(), preferences: NotificationPreferences });
export type Muted = Static<typeof Muted>;

export const PrivacyBody = Type.Object({ privateNotifications: Type.Optional(Type.Boolean()) });
export const DoNotDisturbBody = Type.Object({ dnd: Type.Optional(Type.Boolean()) });
export const PresenceBody = Type.Object({
  /** Checked by the route, which names the allowed values. */
  status: Type.Optional(Type.Unknown()),
  /** Idle detection may only move between online and away. */
  automatic: Type.Optional(Type.Boolean())
});

/** The public VAPID key and whether push is on; the one answer without `ok`. */
export const PushConfig = Type.Object({ enabled: Type.Boolean(), vapidPublicKey: Type.String() });
export type PushConfig = Static<typeof PushConfig>;

/** A browser PushSubscription as toJSON() gives it; the push service checks it. */
export const SubscribeBody = Type.Object({
  subscription: Type.Optional(
    Type.Object({
      endpoint: Type.Optional(Type.String()),
      expirationTime: Type.Optional(Nullable(Type.Number())),
      keys: Type.Optional(Type.Object({ p256dh: Type.Optional(Type.String()), auth: Type.Optional(Type.String()) }))
    })
  )
});
export const UnsubscribeBody = Type.Object({ endpoint: Type.Optional(Type.String()) });

// --- the inbox ----------------------------------------------------------------------

export const InboxItem = Type.Object({
  id: Type.String(),
  roomId: Type.String(),
  sourceMessageId: Type.String(),
  actorUserId: Type.String(),
  reasons: Type.Array(Type.Union([Type.Literal('mention'), Type.Literal('reply')])),
  revision: Type.Number(),
  createdAt: Nullable(Type.Number()),
  updatedAt: Nullable(Type.Number()),
  readAt: Nullable(Type.Number()),
  retractedAt: Nullable(Type.Number()),
  /** Empty once the message is retracted. */
  body: Type.String(),
  cursor: Type.Optional(Type.String())
});
export type InboxItem = Static<typeof InboxItem>;

export const InboxQuery = Type.Object({ cursor: Type.Optional(Type.String()), limit: Type.Optional(Type.String()) });

export const InboxPage = Type.Object({
  contractVersion: Type.Literal(1),
  notifications: Type.Array(InboxItem),
  pageInfo: Type.Object({ nextCursor: Type.Optional(Type.String()), hasMore: Type.Boolean() }),
  unreadCount: Type.Number(),
  revision: Type.Number(),
  firstUnread: Nullable(InboxItem)
});
export type InboxPage = Static<typeof InboxPage>;

export const UnreadCount = Ok({ count: Type.Number(), revision: Type.Number() });
export type UnreadCount = Static<typeof UnreadCount>;

export const InboxItemRead = Ok({ notification: InboxItem, unreadCount: Type.Number(), revision: Type.Number() });
export type InboxItemRead = Static<typeof InboxItemRead>;

export const ReadAllBody = Type.Object({ through: Type.Optional(Nullable(Type.String())) });
export const InboxReadAll = Ok({
  updated: Nullable(Type.Number()),
  unreadCount: Type.Number(),
  revision: Type.Number()
});
export type InboxReadAll = Static<typeof InboxReadAll>;

export const InboxResync = Ok({ unreadCount: Type.Number(), revision: Type.Number() });
export type InboxResync = Static<typeof InboxResync>;

export const NotificationIdParams = Type.Object({ notificationId: Type.String() });

export const RoomLevel = Ok({ level: NotificationLevel });
export type RoomLevel = Static<typeof RoomLevel>;
export const RoomLevelBody = Type.Object({ level: Type.Optional(Type.String()) });
