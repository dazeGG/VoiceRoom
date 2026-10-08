// The API side of durable message delivery: it LISTENs for the worker's
// voice_room_message_delivery notifications, reads the outbox event and
// fans the message out to this replica's sockets. Claiming and retrying are
// the worker's job (workers/message-delivery.ts). The worker marks an event
// delivered once it has notified, whether or not anyone was listening, so a
// lost LISTEN connection is reopened here and the events delivered while it
// was down are replayed: otherwise live chat would stop until a restart while
// the outbox and the health check both looked fine.

import type { DirectMessage as StoredDirectMessage } from '../social/social-records.ts';
import type { AccountMessage } from '../../realtime/account-events.ts';
import type { Logger } from 'pino';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import type { MessageProjection } from './message-projection.ts';
import type { StoredUser } from '../account/user-records.ts';
import type { RoomChatMessage } from './room-chat-views.ts';

const CHANNEL = 'voice_room_message_delivery';
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 30_000;

interface DeliveryEvent {
  type?: string;
  conversation?: { type?: string; id?: string };
  message?: { senderId?: string; recipientId?: string; [key: string]: unknown };
}

interface ListenClient {
  on(event: 'notification', listener: (notification: { channel: string; payload?: string }) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  off(event: 'notification', listener: (notification: { channel: string; payload?: string }) => void): unknown;
  query(sql: string): Promise<unknown>;
  /** An error destroys the connection instead of returning it to the pool. */
  release(error?: Error): void;
}

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
  let listener: {
    client: ListenClient;
    onNotification: (notification: { channel: string; payload?: string }) => void;
  } | null = null;

  async function dispatchMessageDeliveryEvent(event: DeliveryEvent | null | undefined): Promise<void> {
    if (!event || event.type !== 'message.created' || !event.message) return;
    if (event.conversation?.type === 'room') {
      const roomId = event.conversation.id as string;
      // The outbox carries the stored message; the runtime makes it public.
      const message = event.message as unknown as RoomChatMessage;
      deps.broadcastChatMessage(roomId, await deps.projection.project('room', message, { roomId }));
      return;
    }
    if (event.conversation?.type === 'dm') {
      // The outbox carries the stored message as the store wrote it.
      const message = event.message as unknown as StoredDirectMessage;
      const peerId = message.senderId === event.conversation.id ? message.recipientId : event.conversation.id;
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

  function lose(client: ListenClient, error?: unknown): void {
    const current = listener;
    if (!current || current.client !== client) return;
    listener = null;
    lostAt ??= new Date();
    deps.logger().error({ evt: LOG_EVENTS.MESSAGE_LISTENER_FAILED, err: error }, 'message delivery listener failed');
    client.off('notification', current.onNotification);
    client.release(error instanceof Error ? error : new Error('message delivery listener lost'));
    scheduleRetry();
  }

  async function replayMissed(): Promise<void> {
    const since = lostAt;
    const outbox = deps.outbox();
    if (!since || !outbox) return;
    lostAt = null;
    const events = await outbox.listDeliveredSince(since);
    for (const event of events) {
      await dispatchMessageDeliveryEvent(event.payload as DeliveryEvent).catch(reportDispatchFailure);
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
    let client: ListenClient | null = null;
    try {
      client = await pool.connect();
      const connected = client;
      const onNotification = (notification: { channel: string; payload?: string }) => {
        if (notification.channel !== CHANNEL) return;
        void (async () => {
          const parsed = JSON.parse(notification.payload || '{}') as { eventId?: string };
          const row = parsed.eventId ? await outbox.getEvent(parsed.eventId) : null;
          // The outbox stores the event its writer enqueued; dispatch checks its fields.
          if (row?.payload) await dispatchMessageDeliveryEvent(row.payload as DeliveryEvent);
        })().catch(reportDispatchFailure);
      };
      client.on('notification', onNotification);
      client.on('error', (error) => lose(connected, error));
      client.on('end', () => lose(connected));
      await client.query(`LISTEN ${CHANNEL}`);
      listener = { client, onNotification };
    } catch (error) {
      client?.release(error instanceof Error ? error : new Error('LISTEN failed'));
      throw error;
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
    current.client.off('notification', current.onNotification);
    await current.client.query(`UNLISTEN ${CHANNEL}`).catch(() => {});
    current.client.release();
  }

  return {
    dispatch: dispatchMessageDeliveryEvent,
    start: startMessageDeliveryListener,
    stop: stopMessageDeliveryListener
  };
}

export type MessageDeliveryRelay = ReturnType<typeof createMessageDeliveryRelay>;
