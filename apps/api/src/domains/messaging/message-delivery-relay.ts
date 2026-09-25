// The API side of durable message delivery: it LISTENs for the worker's
// voice_room_message_delivery notifications, reads the outbox event and
// fans the message out to this replica's sockets. Claiming and retrying are
// the worker's job (workers/message-delivery.ts), so nothing here runs on a timer.

import type { Logger } from 'pino';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import type { MessageProjection } from './message-projection.ts';

const CHANNEL = 'voice_room_message_delivery';

interface DeliveryEvent {
  type?: string;
  conversation?: { type?: string; id?: string };
  message?: { senderId?: string; recipientId?: string; [key: string]: unknown };
}

interface ListenClient {
  on(event: 'notification', listener: (notification: { channel: string; payload?: string }) => void): unknown;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  off(event: 'notification', listener: (notification: { channel: string; payload?: string }) => void): unknown;
  query(sql: string): Promise<unknown>;
  release(): void;
}

export interface MessageDeliveryRelayDeps {
  enabled: boolean;
  pool(): { connect(): Promise<ListenClient> } | null;
  outbox(): { getEvent(eventId: string): Promise<{ payload?: unknown } | null> } | null;
  projection: MessageProjection;
  broadcastChatMessage(roomId: string, message: unknown): void;
  notifyUser(userId: string, event: Record<string, unknown>): void;
  findUser(userId: string): Promise<{ id: string; [key: string]: unknown } | null>;
  /** The recipient's DM notification and push. */
  broadcastDmNotification(
    recipientId: string,
    sender: { id: string; [key: string]: unknown },
    message: { id: string; body?: string; createdAt?: unknown }
  ): Promise<unknown>;
  publicChatMessage(message: unknown): unknown;
  logger(): Pick<Logger, 'error'>;
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
      const projected = await deps.projection.project('room', event.message as { id?: string }, { roomId });
      deps.broadcastChatMessage(roomId, deps.publicChatMessage(projected));
      return;
    }
    if (event.conversation?.type === 'dm') {
      const message = event.message as {
        senderId: string;
        recipientId: string;
        id: string;
        body?: string;
        createdAt?: unknown;
      };
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

  async function startMessageDeliveryListener(): Promise<void> {
    if (!deps.enabled || listener) return;
    const pool = deps.pool();
    const outbox = deps.outbox();
    if (!pool || !outbox) return;
    const client = await pool.connect();
    const onNotification = (notification: { channel: string; payload?: string }) => {
      if (notification.channel !== CHANNEL) return;
      void (async () => {
        const parsed = JSON.parse(notification.payload || '{}') as { eventId?: string };
        const row = parsed.eventId ? await outbox.getEvent(parsed.eventId) : null;
        // The outbox stores the event its writer enqueued; dispatch checks its fields.
        if (row?.payload) await dispatchMessageDeliveryEvent(row.payload as DeliveryEvent);
      })().catch((error) =>
        deps
          .logger()
          .error(
            { evt: LOG_EVENTS.MESSAGE_EVENT_DISPATCH_FAILED, err: error },
            'failed to dispatch a durable message event'
          )
      );
    };
    client.on('notification', onNotification);
    client.on('error', (error) =>
      deps.logger().error({ evt: LOG_EVENTS.MESSAGE_LISTENER_FAILED, err: error }, 'message delivery listener failed')
    );
    await client.query(`LISTEN ${CHANNEL}`);
    listener = { client, onNotification };
  }

  async function stopMessageDeliveryListener(): Promise<void> {
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
