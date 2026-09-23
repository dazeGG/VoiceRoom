import { buildMessageDeliveryEvent, type ConversationRef, type MessageDeliveryEvent } from '@voice-room/shared/messaging-send';

type Message = { id?: string; cursor?: unknown; [key: string]: unknown };
type Broadcaster = (id: string, event: Record<string, unknown>) => unknown;

export type MessageRealtimeAdapter = Readonly<{
  publishDirectReply(input?: { userIds?: unknown; peerUserId?: string; senderUserId?: string; message?: Message | null }): number;
  publishRoomReply(input?: { roomId?: string; message?: Message | null }): boolean;
}>;

function createMessageRealtimeAdapter({ broadcastRoom, broadcastAccount, createEventId }: {
  broadcastRoom?: Broadcaster;
  broadcastAccount?: Broadcaster;
  createEventId?: (message: Message, conversation: ConversationRef) => string;
} = {}): MessageRealtimeAdapter {
  const roomBroadcaster: Broadcaster = typeof broadcastRoom === 'function' ? broadcastRoom : () => false;
  const accountBroadcaster: Broadcaster = typeof broadcastAccount === 'function' ? broadcastAccount : () => false;
  const eventIdFactory = typeof createEventId === 'function'
    ? createEventId
    : (message: Message) => `message.created:${message.id}`;

  function deliveryEvent(conversation: ConversationRef, message: Message): MessageDeliveryEvent | null {
    return buildMessageDeliveryEvent({
      eventId: eventIdFactory(message, conversation),
      type: 'message.created',
      conversation,
      messageId: message.id,
      cursor: message.cursor,
      message
    });
  }

  function publishRoomReply({ roomId, message }: { roomId?: string; message?: Message | null } = {}): boolean {
    if (!roomId || !message?.id) return false;
    const event = deliveryEvent({ type: 'room', id: roomId }, message);
    if (!event) return false;
    return roomBroadcaster(roomId, {
      type: 'room.chat.message',
      payload: { message, delivery: event }
    }) !== false;
  }

  function publishDirectReply({ userIds, peerUserId, senderUserId, message }: {
    userIds?: unknown;
    peerUserId?: string;
    senderUserId?: string;
    message?: Message | null;
  } = {}): number {
    if (!message?.id) return 0;
    const participants = new Set<unknown>(Array.isArray(userIds) ? userIds : [senderUserId, peerUserId]);
    participants.delete(undefined);
    participants.delete(null);
    participants.delete('');
    if (participants.size === 0) return 0;

    const conversationId = [senderUserId, peerUserId].filter(Boolean).sort().join(':');
    const event = deliveryEvent({ type: 'dm', id: conversationId }, message);
    if (!event) return 0;

    let published = 0;
    for (const userId of participants) {
      if (accountBroadcaster(userId as string, {
        // Existing account-event bridge converts this legacy internal name to
        // the public `dm.message` envelope. The message already carries the
        // optional one-level replyPreview for old-client compatibility.
        type: 'dm-message',
        message,
        delivery: event
      }) !== false) published += 1;
    }
    return published;
  }

  return Object.freeze({ publishDirectReply, publishRoomReply });
}

export { createMessageRealtimeAdapter };
