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
    case 'dm-read':
      return buildServerEnvelope('dm.read', { userId: message.userId });
    default:
      return null;
  }
}

module.exports = {
  toWsAccountEvent
};