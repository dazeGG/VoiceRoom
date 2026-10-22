// The API side of durable message delivery: it LISTENs for the worker's
// voice_room_message_delivery notifications, reads the outbox event and
// fans the message out to this replica's sockets. Claiming and retrying are
// the worker's job (workers/message-delivery.ts). The worker marks an event
// delivered once it has notified, whether or not anyone was listening, so a
// lost LISTEN connection is reopened here and the events delivered while it
// was down are replayed: otherwise live chat would stop until a restart while
// the outbox and the health check both looked fine.

import { isRecord } from '@voice-room/shared/guards';
import { isStoredDirectMessage } from '../social/social-records.ts';
import type { AccountMessage } from '../../realtime/account-events.ts';
import type { Logger } from 'pino';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import {
  dropListener,
  startListening,
  stopListener,
  type ListenClient,
  type Listener
} from '../../platform/db/listen.ts';
import type { MessageProjection } from './message-projection.ts';
import type { StoredUser } from '../account/user-records.ts';
import { isStoredChatMessage, type RoomChatMessage } from './room-chat-views.ts';

const CHANNEL = 'voice_room_message_delivery';
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

export interface MessageDeliveryRelayDeps {
  enabled: boolean;
  pool(): { connect(): Promise<ListenClient> } | null;
  outbox(): {
    getEvent(eventId: string): Promise<{ payload?: unknown } | null>;
    listDeliveredSince(since: Date): Promise<Array<{ payload?: unknown }>>;
  } | null;
  projection: MessageProjection;
  broadcastChatMessage(roomId: string, message: RoomChatMessage): void;
  notifyUser(userId: string, event: AccountMessage): void;
  findUser(userId: string): Promise<StoredUser | null>;
  /** The recipient's DM notification and push. */
  broadcastDmNotification(
    recipientId: string,
    sender: StoredUser,
    message: { id: string; body: string; createdAt: number | null }
  ): Promise<unknown>;
  logger(): Pick<Logger, 'error' | 'info'>;
}

export function createMessageDeliveryRelay(deps: MessageDeliveryRelayDeps) {
  let listener: Listener | null = null;

  // The outbox stores the event its writer enqueued; dispatch checks its fields.
  async function dispatchMessageDeliveryEvent(event: unknown): Promise<void> {
    if (!isRecord(event) || event.type !== 'message.created') return;
    const { conversation, message } = event;
    if (!isRecord(conversation) || typeof conversation.id !== 'string') return;
    if (conversation.type === 'room') {
      const roomId = conversation.id;
      // The outbox carries the stored message; the runtime makes it public.
      if (!isStoredChatMessage(message)) {
        reportMalformedMessage('room', message);
        return;
      }
      deps.broadcastChatMessage(roomId, await deps.projection.project('room', message, { roomId }));
      return;
    }
    if (conversation.type === 'dm') {
      // The outbox carries the stored message as the store wrote it.
      if (!isStoredDirectMessage(message)) {
        reportMalformedMessage('dm', message);
        return;
      }
      const peerId = message.senderId === conversation.id ? message.recipientId : conversation.id;
      const projected = await deps.projection.project('dm', message, { userId: message.senderId, peerId });
      deps.notifyUser(message.senderId, { type: 'dm-message', message: projected });
      deps.notifyUser(message.recipientId, { type: 'dm-message', message: projected });
      // The direct-emit path notifies right after sending; the relayed path
      // has to do the same or DMs never raise a system notification.
      const sender = await deps.findUser(message.senderId).catch(() => null);
      if (sender) await deps.broadcastDmNotification(message.recipientId, sender, projected);
    }
  }

  let stopped = false;
  let connecting = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;
  let lostAt: Date | null = null;

  function reportDispatchFailure(error: unknown): void {
    deps
      .logger()
      .error(
        { evt: LOG_EVENTS.MESSAGE_EVENT_DISPATCH_FAILED, err: error },
        'failed to dispatch a durable message event'
      );
  }

  // A stored message that no longer fits its contract (a row written by
  // another version) is dropped from realtime delivery, but never silently.
  function reportMalformedMessage(conversation: 'room' | 'dm', message: unknown): void {
    const messageId = isRecord(message) && typeof message.id === 'string' ? message.id : null;
    deps
      .logger()
      .error(
        { evt: LOG_EVENTS.MESSAGE_EVENT_DISPATCH_FAILED, conversation, messageId },
        'a durable message event carried a malformed message'
      );
  }

  function scheduleRetry(): void {
    if (stopped || retryTimer) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** retryAttempt);
    retryAttempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void listen().catch(() => scheduleRetry());
    }, delay);
    retryTimer.unref?.();
  }

  function lose(lost: Listener, error?: unknown): void {
    if (listener !== lost) return;
    listener = null;
    lostAt ??= new Date();
    deps.logger().error({ evt: LOG_EVENTS.MESSAGE_LISTENER_FAILED, err: error }, 'message delivery listener failed');
    dropListener(lost, error);
    scheduleRetry();
  }

  async function replayMissed(): Promise<void> {
    const since = lostAt;
    const outbox = deps.outbox();
    if (!since || !outbox) return;
    lostAt = null;
    const events = await outbox.listDeliveredSince(since);
    for (const event of events) {
      await dispatchMessageDeliveryEvent(event.payload).catch(reportDispatchFailure);
    }
    deps
      .logger()
      .info(
        { evt: LOG_EVENTS.MESSAGE_LISTENER_RESTORED, replayed: events.length },
        'message delivery listener restored'
      );
  }

  async function listen(): Promise<void> {
    if (stopped || listener || connecting) return;
    const pool = deps.pool();
    const outbox = deps.outbox();
    if (!pool || !outbox) return;
    connecting = true;
    try {
      listener = await startListening(pool, CHANNEL, {
        onPayload: (payload) => {
          void (async () => {
            const parsed: unknown = JSON.parse(payload || '{}');
            const eventId = isRecord(parsed) && typeof parsed.eventId === 'string' ? parsed.eventId : '';
            const row = eventId ? await outbox.getEvent(eventId) : null;
            if (row?.payload) await dispatchMessageDeliveryEvent(row.payload);
          })().catch(reportDispatchFailure);
        },
        onLost: lose
      });
    } finally {
      connecting = false;
    }
    if (stopped) {
      await stopMessageDeliveryListener();
      return;
    }
    retryAttempt = 0;
    await replayMissed().catch(reportDispatchFailure);
  }

  async function startMessageDeliveryListener(): Promise<void> {
    if (!deps.enabled) return;
    stopped = false;
    await listen();
  }

  async function stopMessageDeliveryListener(): Promise<void> {
    stopped = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const current = listener;
    listener = null;
    if (!current) return;
    await stopListener(current);
  }

  return {
    dispatch: dispatchMessageDeliveryEvent,
    start: startMessageDeliveryListener,
    stop: stopMessageDeliveryListener
  };
}

export type MessageDeliveryRelay = ReturnType<typeof createMessageDeliveryRelay>;
