'use strict';

const { buildServerEnvelope } = require('./envelope');

function legacyPeerMessageToWs(message, roomId) {
  if (!message || typeof message.type !== 'string') return null;

  switch (message.type) {
    case 'ping':
      return buildServerEnvelope('pong', { at: message.at });
    case 'peer-joined':
      return buildServerEnvelope('room.peer.joined', { roomId, peer: message.peer });
    case 'peer-left':
      return buildServerEnvelope('room.peer.left', {
        roomId,
        peerId: message.peerId,
        reason: message.reason || 'left'
      });
    case 'peer-updated':
      return buildServerEnvelope('room.peer.updated', { roomId, peer: message.peer });
    case 'room-updated':
      return buildServerEnvelope('room.updated', { room: message.room });
    case 'room-deleted':
      return buildServerEnvelope('room.deleted', { roomId: message.roomId });
    case 'room-not-found':
      return buildServerEnvelope('room.not_found', { roomId: message.roomId || roomId });
    case 'room-full':
      return buildServerEnvelope('room.full', { roomId, maxRoomPeers: message.maxRoomPeers });
    case 'chat-message':
      return buildServerEnvelope('room.chat.message', {
        roomId,
        message: message.message
      });
    default:
      return null;
  }
}

module.exports = {
  legacyPeerMessageToWs
};