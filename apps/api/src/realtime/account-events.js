'use strict';

const { buildServerEnvelope } = require('./envelope');

function toWsAccountEvent(message) {
  if (!message || typeof message.type !== 'string') return null;

  switch (message.type) {
    case 'presence':
      return buildServerEnvelope('friend.presence', {
        userId: message.userId,
        online: Boolean(message.online)
      });
    case 'friend-request':
      return buildServerEnvelope('friend.request', { direction: 'incoming' });
    case 'friend-accepted':
      return buildServerEnvelope('friend.accepted', { userId: message.userId });
    case 'friend-removed':
      return buildServerEnvelope('friend.removed', { userId: message.userId });
    case 'dm-message':
      return buildServerEnvelope('dm.message', { message: message.message });
    case 'notification.dm.message':
      return buildServerEnvelope('notification.dm.message', {
        dedupeKey: message.dedupeKey,
        peer: message.peer,
        message: message.message
      });
    case 'notification.room.message':
      return buildServerEnvelope('notification.room.message', {
        dedupeKey: message.dedupeKey,
        room: message.room,
        sender: message.sender,
        message: message.message
      });
    case 'notification.friend.request':
      return buildServerEnvelope('notification.friend.request', {
        dedupeKey: message.dedupeKey,
        requester: message.requester,
        requestId: message.requestId
      });
    case 'notification.friend.accepted':
      return buildServerEnvelope('notification.friend.accepted', {
        dedupeKey: message.dedupeKey,
        user: message.user,
        context: message.context
      });
    case 'dm-read':
      return buildServerEnvelope('dm.read', { userId: message.userId });
    case 'dm.message.deleted':
    case 'dm-message-deleted':
      return buildServerEnvelope('dm.message.deleted', {
        messageId: message.messageId,
        peerUserId: message.peerUserId
      });
    default:
      return null;
  }
}

module.exports = {
  toWsAccountEvent
};