'use strict';

const { normalizeRoomId } = require('@voice-room/shared/validation');
const { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage } = require('./envelope');

function createWsHandler({
  registry,
  roomRuntime,
  resolveSessionUser,
  getFriendIds,
  isUserOnline
}) {
  async function handleMessage(connection, sessionUser, envelope) {
    if (envelope.type === 'hello') {
      registry.touch(connection);
      return;
    }

    if (envelope.type === 'ping') {
      registry.touch(connection);
      registry.sendToConnection(
        connection,
        buildServerEnvelope('pong', { at: envelope.payload.at }, envelope.id)
      );
      return;
    }

    if (envelope.type === 'room.preview.subscribe') {
      const roomId = normalizeRoomId(envelope.payload.roomId);
      if (!roomId) {
        registry.sendToConnection(
          connection,
          buildServerErrorEnvelope('invalid_room_id', 'Invalid room id', envelope.id)
        );
        return;
      }
      await roomRuntime.subscribePreview(connection, roomId);
      return;
    }

    if (envelope.type === 'room.preview.unsubscribe') {
      const roomId = normalizeRoomId(envelope.payload.roomId);
      if (roomId) roomRuntime.unsubscribePreview(connection, roomId);
      return;
    }

    if (envelope.type === 'room.join') {
      const result = await roomRuntime.joinVoiceRoom(connection, envelope.payload, sessionUser);
      if (!result.ok && result.message) {
        registry.sendToConnection(
          connection,
          buildServerErrorEnvelope(result.code || 'join_failed', result.message, envelope.id)
        );
      }
      return;
    }

    if (envelope.type === 'room.leave') {
      await roomRuntime.leaveVoiceRoom(connection, {
        roomId: normalizeRoomId(envelope.payload.roomId),
        peerId: envelope.payload.peerId
      });
      return;
    }

    if (envelope.type === 'room.peer.update') {
      const result = await roomRuntime.updatePeerState(connection, envelope.payload);
      if (!result.ok) {
        registry.sendToConnection(
          connection,
          buildServerErrorEnvelope(result.code || 'update_failed', 'Peer update rejected', envelope.id)
        );
      }
      return;
    }

    registry.sendToConnection(
      connection,
      buildServerErrorEnvelope('not_implemented', `Unsupported message type: ${envelope.type}`, envelope.id)
    );
  }

  async function handleConnection(socket, req) {
    const session = await resolveSessionUser(req);
    const sessionUser = session?.user || null;
    const connection = sessionUser
      ? registry.addConnection(sessionUser.id, socket)
      : registry.addGuestConnection(socket);

    if (sessionUser && registry.rejectOverLimit(sessionUser.id)) {
      registry.removeConnection(connection);
      socket.close(4429, 'Too many connections');
      return;
    }

    if (sessionUser) {
      let friendIds = [];
      try {
        friendIds = await getFriendIds(sessionUser.id);
      } catch (error) {
        console.error('Failed to load friends for WS ready:', error);
      }
      registry.sendReady(connection, {
        userId: sessionUser.id,
        onlineFriendIds: friendIds.filter((friendId) => isUserOnline(friendId))
      });
    } else {
      registry.sendReady(connection, { guest: true });
    }

    socket.on('message', (raw) => {
      const parsed = parseInboundMessage(String(raw));
      if (!parsed.ok) {
        registry.sendToConnection(
          connection,
          buildServerErrorEnvelope(parsed.code, 'Invalid WebSocket message')
        );
        return;
      }
      void handleMessage(connection, sessionUser, parsed.envelope);
    });

    socket.on('close', () => {
      registry.removeConnection(connection);
    });

    socket.on('error', () => {
      registry.removeConnection(connection);
    });
  }

  return {
    handleConnection
  };
}

module.exports = {
  createWsHandler
};