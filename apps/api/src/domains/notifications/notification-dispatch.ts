// Delivering a notification outside the app: web push with the account's
// preferences applied, and the live + push notice for a new direct message.

import type { Logger } from 'pino';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { resolvePushTtl, shouldDeliverPush } from '../../lib/push-service.ts';
import { notificationActor, type SocialUser } from '../social/social-views.ts';

interface Preferences {
  privateNotifications?: boolean;
  mutedPeerIds: string[];
  [key: string]: unknown;
}

export interface PushPayload {
  type: string;
  title: string;
  body?: string;
  /** Replaces the body for accounts that chose private notification text. */
  privateBody?: string;
  [key: string]: unknown;
}

export interface PushContext {
  /** Security alerts reach the account even in do-not-disturb. */
  ignorePreferences?: boolean;
  expiresAt?: number;
  peerUserId?: string;
  roomId?: string;
  [key: string]: unknown;
}

export interface NotificationDispatchDeps {
  push(): { config: { enabled: boolean }; sendToUser(userId: string, payload: Record<string, unknown>, context: Record<string, unknown>): Promise<unknown> };
  preferences(userId: string): Promise<Preferences>;
  notifyUser(userId: string, event: Record<string, unknown>): number;
  logger(): Pick<Logger, 'warn' | 'error'>;
}

export function createNotificationDispatch(deps: NotificationDispatchDeps) {
  // A failed push is logged, never thrown: it is a side effect of something
  // that already succeeded.
  async function queuePush(userId: string, payload: PushPayload, context: PushContext = {}): Promise<void> {
    try {
      if (!deps.push().config.enabled) return;
      const preferences = await deps.preferences(userId);
      if (!context.ignorePreferences && !shouldDeliverPush(preferences, context)) return;
      const body = preferences.privateNotifications && payload.privateBody ? payload.privateBody : payload.body;
      const { privateBody: _privateBody, ...publicPayload } = payload;
      const ttl = resolvePushTtl(context);
      if (ttl === null) return;
      const deliveryContext = ttl === undefined ? context : { ...context, ttl };
      await deps.push().sendToUser(userId, { ...publicPayload, body }, deliveryContext);
    } catch (error) {
      deps.logger().warn({ evt: LOG_EVENTS.PUSH_SEND_FAILED, userId, err: error }, 'failed to send a push notification');
    }
  }

  // Returns how many of the recipient's sockets got the live notice.
  async function broadcastDmNotification(recipientUserId: string, sender: SocialUser | null | undefined, message: { id: string; body?: string; createdAt?: unknown }): Promise<number> {
    if (!recipientUserId || !sender || recipientUserId === sender.id) return 0;
    try {
      const preferences = await deps.preferences(recipientUserId);
      if (preferences.mutedPeerIds.includes(sender.id)) return 0;
      const notification = {
        type: 'notification.dm.message',
        dedupeKey: `dm:${message.id}`,
        peer: notificationActor(sender),
        message: { id: message.id, body: message.body, createdAt: message.createdAt }
      };
      const broadcastCount = deps.notifyUser(recipientUserId, notification);
      void queuePush(recipientUserId, {
        type: 'dm.message',
        title: sender.displayName || sender.login || 'Новое сообщение',
        body: message.body,
        privateBody: 'Откройте VoiceRoom, чтобы прочитать сообщение.',
        tag: `dm:${sender.id}`,
        dedupeKey: notification.dedupeKey,
        url: `/?dm=${encodeURIComponent(sender.id)}`
      }, { peerUserId: sender.id });
      return broadcastCount;
    } catch (error) {
      deps.logger().error({ evt: LOG_EVENTS.NOTIFICATION_BROADCAST_FAILED, err: error }, 'failed to broadcast a direct message notification');
      return 0;
    }
  }

  return { queuePush, broadcastDmNotification };
}

export type NotificationDispatch = ReturnType<typeof createNotificationDispatch>;
