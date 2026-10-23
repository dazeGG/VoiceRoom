// Delivering a notification outside the app: a push (Web Push and the Android
// app) with the account's preferences applied, and the live + push notice for
// a new direct message.

import type { AccountMessage } from '../../realtime/account-events.ts';
import type { Logger } from 'pino';
import type { PushPayload as WebPushPayload } from '@voice-room/shared/notifications';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { resolvePushTtl, shouldDeliverPush } from '../../lib/push-service.ts';
import { notificationActor, type SocialUser } from '../social/social-views.ts';

interface Preferences {
  privateNotifications?: boolean;
  mutedPeerIds: string[];
  [key: string]: unknown;
}

export type PushPayload = WebPushPayload & {
  type: string;
  title: string;
  /** Replaces the body for accounts that chose private notification text. */
  privateBody?: string;
};

export interface PushContext {
  /** Security alerts reach the account even in do-not-disturb. */
  ignorePreferences?: boolean;
  expiresAt?: number;
  peerUserId?: string;
  roomId?: string;
  /** Extra string keys for the Android app's push data; Web Push payloads never carry them. */
  nativeData?: Record<string, string>;
  /** Web Push only: another push already tells the Android app. */
  skipNative?: boolean;
  [key: string]: unknown;
}

export interface NotificationDispatchDeps {
  push(): {
    config: { enabled: boolean };
    sendToUser(userId: string, payload: WebPushPayload, context: Record<string, unknown>): Promise<unknown>;
  };
  preferences(userId: string): Promise<Preferences>;
  notifyUser(userId: string, event: AccountMessage): number;
  logger(): Pick<Logger, 'warn' | 'error'>;
}

// Private notification text hides the room a ring leads into, as its Web
// Push body does; the caller's name stays, as in the Web Push title.
const ROOM_NAME_KEYS: ReadonlySet<string> = new Set(['roomName', 'roomEmoji']);

function withoutRoomNames(nativeData: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(nativeData).filter(([key]) => !ROOM_NAME_KEYS.has(key)));
}

export function createNotificationDispatch(deps: NotificationDispatchDeps) {
  // A failed push is logged, never thrown: it is a side effect of something
  // that already succeeded.
  async function queuePush(userId: string, payload: PushPayload, context: PushContext = {}): Promise<void> {
    try {
      if (!deps.push().config.enabled) return;
      const preferences = await deps.preferences(userId);
      if (!context.ignorePreferences && !shouldDeliverPush(preferences, context)) return;
      const hideText = Boolean(preferences.privateNotifications && payload.privateBody);
      const body = hideText ? payload.privateBody : payload.body;
      const { privateBody: _privateBody, ...publicPayload } = payload;
      const ttl = resolvePushTtl(context);
      if (ttl === null) return;
      const visibleContext =
        hideText && context.nativeData ? { ...context, nativeData: withoutRoomNames(context.nativeData) } : context;
      const deliveryContext = ttl === undefined ? visibleContext : { ...visibleContext, ttl };
      await deps.push().sendToUser(userId, { ...publicPayload, body }, deliveryContext);
    } catch (error) {
      deps
        .logger()
        .warn({ evt: LOG_EVENTS.PUSH_SEND_FAILED, userId, err: error }, 'failed to send a push notification');
    }
  }

  // Returns how many of the recipient's sockets got the live notice.
  async function broadcastDmNotification(
    recipientUserId: string,
    sender: SocialUser | null | undefined,
    message: { id: string; body: string; createdAt: number | null; invite?: unknown }
  ): Promise<number> {
    if (!recipientUserId || !sender || recipientUserId === sender.id) return 0;
    try {
      const preferences = await deps.preferences(recipientUserId);
      if (preferences.mutedPeerIds.includes(sender.id)) return 0;
      const dedupeKey = `dm:${message.id}`;
      const notification: AccountMessage = {
        type: 'notification.dm.message',
        dedupeKey,
        peer: notificationActor(sender),
        message: { id: message.id, body: message.body, createdAt: message.createdAt ?? Date.now() }
      };
      const broadcastCount = deps.notifyUser(recipientUserId, notification);
      void queuePush(
        recipientUserId,
        {
          type: 'dm.message',
          title: sender.displayName || sender.login || 'Новое сообщение',
          body: message.body,
          privateBody: 'Откройте VoiceRoom, чтобы прочитать сообщение.',
          tag: `dm:${sender.id}`,
          dedupeKey,
          url: `/?dm=${encodeURIComponent(sender.id)}`
        },
        // A room invitation comes with a ring, whose push already reaches the app.
        message.invite != null
          ? { peerUserId: sender.id, skipNative: true }
          : { peerUserId: sender.id, nativeData: { peerUserId: sender.id, messageId: message.id } }
      );
      return broadcastCount;
    } catch (error) {
      deps
        .logger()
        .error(
          { evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, err: error },
          'failed to broadcast a direct message notification'
        );
      return 0;
    }
  }

  return { queuePush, broadcastDmNotification };
}

export type NotificationDispatch = ReturnType<typeof createNotificationDispatch>;
