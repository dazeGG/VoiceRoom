'use strict';

const { buildMessageDeliveryEvent } = require('@voice-room/shared/messaging-send');

function createMessageRealtimeAdapter({ broadcastRoom, broadcastAccount, createEventId } = {}) {
  const roomBroadcaster = typeof broadcastRoom === 'function' ? broadcastRoom : () => false;
  const accountBroadcaster = typeof broadcastAccount === 'function' ? broadcastAccount : () => false;
  const eventIdFactory = typeof createEventId === 'function'
    ? createEventId
    : (message) => `message.created:${message.id}`;

  function deliveryEvent(conversation, message) {
    return buildMessageDeliveryEvent({
      eventId: eventIdFactory(message, conversation),
      type: 'message.created',
      conversation,
      messageId: message.id,
      cursor: message.cursor,
      message
    });
  }

  function publishRoomReply({ roomId, message } = {}) {
    if (!roomId || !message?.id) return false;
    const event = deliveryEvent({ type: 'room', id: roomId }, message);
    if (!event) return false;
    return roomBroadcaster(roomId, {
      type: 'room.chat.message',
      payload: { message, delivery: event }
    }) !== false;
  }

  function publishDirectReply({ userIds, peerUserId, senderUserId, message } = {}) {
    if (!message?.id) return 0;
    const participants = new Set(Array.isArray(userIds) ? userIds : [senderUserId, peerUserId]);
    participants.delete(undefined);
    participants.delete(null);
    participants.delete('');
    if (participants.size === 0) return 0;

    const conversationId = [senderUserId, peerUserId].filter(Boolean).sort().join(':');
    const event = deliveryEvent({ type: 'dm', id: conversationId }, message);
    if (!event) return 0;

    let published = 0;
    for (const userId of participants) {
      if (accountBroadcaster(userId, {
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

module.exports = { createMessageRealtimeAdapter };
