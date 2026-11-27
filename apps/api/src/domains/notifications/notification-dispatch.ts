// Delivering a notification outside the app: a push (Web Push and the Android
// app) with the account's preferences applied, and the live + push notice for
// a new direct message.

import type { AccountMessage } from '../../realtime/account-events.ts';
import type { Logger } from 'pino';
import type { PushPayload as WebPushPayload } from '@voiceroom/shared/notifications';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { resolvePushTtl, shouldDeliverPush } from '../../lib/push-service.ts';
import { notificationActor, type SocialUser } from '../social/social-views.ts';
import { DirectMessageInvite } from '@voiceroom/shared/contracts/messages';
import { Value } from 'typebox/value';

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
  /**
   * Runs the DM notice and the start of its push only while the message still
   * exists, ordered with conversation deletion. Without it they always run.
   */
  whileMessageLive?(message: { id: string; senderId: string; recipientId: string }, emit: () => void): Promise<boolean>;
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
  function pushFailed(userId: string, error: unknown): void {
    deps.logger().warn({ evt: LOG_EVENTS.PUSH_SEND_FAILED, userId, err: error }, 'failed to send a push notification');
  }

  // Applies the preferences and returns the transport call, or null when no
  // push is due. Starting it is synchronous, so a caller can fence it.
  function preparePush(
    userId: string,
    payload: PushPayload,
    context: PushContext,
    preferences: Preferences
  ): (() => Promise<void>) | null {
    const push = deps.push();
    if (!push.config.enabled) return null;
    if (!context.ignorePreferences && !shouldDeliverPush(preferences, context)) return null;
    const hideText = Boolean(preferences.privateNotifications && payload.privateBody);
    const body = hideText ? payload.privateBody : payload.body;
    const { privateBody: _privateBody, ...publicPayload } = payload;
    const ttl = resolvePushTtl(context);
    if (ttl === null) return null;
    const visibleContext =
      hideText && context.nativeData ? { ...context, nativeData: withoutRoomNames(context.nativeData) } : context;
    const deliveryContext = ttl === undefined ? visibleContext : { ...visibleContext, ttl };
    return async () => {
      try {
        await push.sendToUser(
          userId,
          { ...publicPayload, body, ...(payload.copy ? { notificationPrivate: hideText } : {}) },
          deliveryContext
        );
      } catch (error) {
        pushFailed(userId, error);
      }
    };
  }

  async function queuePush(userId: string, payload: PushPayload, context: PushContext = {}): Promise<void> {
    try {
      if (!deps.push().config.enabled) return;
      const send = preparePush(userId, payload, context, await deps.preferences(userId));
      await send?.();
    } catch (error) {
      pushFailed(userId, error);
    }
  }

  /** The push with preferences applied, started by the caller; null when none is due. */
  async function preparedPush(
    userId: string,
    payload: PushPayload,
    context: PushContext = {}
  ): Promise<(() => Promise<void>) | null> {
    try {
      if (!deps.push().config.enabled) return null;
      return preparePush(userId, payload, context, await deps.preferences(userId));
    } catch (error) {
      pushFailed(userId, error);
      return null;
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
      const invite = Value.Check(DirectMessageInvite, message.invite) ? message.invite : null;
      const inviteRoom = invite?.roomName ?? '';
      const notification: AccountMessage = {
        type: 'notification.dm.message',
        dedupeKey,
        peer: notificationActor(sender),
        message: {
          id: message.id,
          body: message.body,
          createdAt: message.createdAt ?? Date.now(),
          ...(invite ? { invite } : {})
        }
      };
      const push = preparePush(
        recipientUserId,
        {
          type: 'dm.message',
          title: sender.displayName || sender.login || 'Новое сообщение',
          body: message.body,
          privateBody: 'Откройте VoiceRoom, чтобы прочитать сообщение.',
          copy: {
            ...(invite
              ? {
                  body: {
                    key: inviteRoom ? ('roomInvitation' as const) : ('roomInvitationUnnamed' as const),
                    args: { room: inviteRoom }
                  }
                }
              : {}),
            ...(!sender.displayName && !sender.login ? { title: { key: 'newMessage' as const } } : {}),
            privateBody: { key: 'privateMessage' }
          },
          tag: `dm:${sender.id}`,
          dedupeKey,
          url: `/?dm=${encodeURIComponent(sender.id)}`
        },
        // A room invitation comes with a ring, whose push already reaches the app.
        message.invite != null
          ? { peerUserId: sender.id, skipNative: true }
          : { peerUserId: sender.id, nativeData: { peerUserId: sender.id, messageId: message.id } },
        preferences
      );
      let broadcastCount = 0;
      const emit = () => {
        broadcastCount = deps.notifyUser(recipientUserId, notification);
        if (push) void push();
      };
      // The preferences lookup can outlast a conversation deletion; the notice
      // and the push start only while the message still exists.
      if (deps.whileMessageLive)
        await deps.whileMessageLive({ id: message.id, senderId: sender.id, recipientId: recipientUserId }, emit);
      else emit();
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

  return { queuePush, preparedPush, broadcastDmNotification };
}

export type NotificationDispatch = ReturnType<typeof createNotificationDispatch>;
