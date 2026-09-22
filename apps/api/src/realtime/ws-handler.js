'use strict';

const {
  normalizePeerId,
  normalizeRoomId,
  normalizeSessionToken
} = require('@voice-room/shared/validation');
const { normalizeTypingActivity } = require('@voice-room/shared/realtime');
const { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage } = require('./envelope');
const { createTypingThrottle } = require('./typing-throttle');
const { LOG_EVENTS } = require('../lib/log-events');
const { createLogger, hashIp } = require('../lib/logger');

function createWsHandler({
  registry,
  roomRuntime,
  resolveSessionUser,
  getFriendIds,
  isUserOnline,
  canTypeToUser = async () => false,
  getClientIp = () => 'unknown',
  now = Date.now,
  logger = createLogger({ name: 'api' })
}) {
  // Every realtime failure is attributed to the connection and the message type
  // that caused it. Without both, a report of "the call keeps dropping" leaves
  // nothing to search: the socket is gone and the stack alone names no user.
  function reportMessageError(error, connection = null, type = '') {
    logger.error({
      evt: LOG_EVENTS.WS_MESSAGE_FAILED,
      connId: connection?.id,
      userId: connection?.userId || undefined,
      type: type || undefined,
      err: error
    }, 'ws message handler failed');
  }

  // Direct typing notices reach only a friend when neither side blocked the
  // other. The check is cached per connection and thread for a short while so
  // a burst of typing costs one lookup, and notices to a thread go through the
  // typing throttle.
  const DM_TYPING_PERMISSION_TTL_MS = 30_000;
  // The client picks the thread ids, so the cache and the lookups behind it are
  // bounded per connection: naming endless strangers can grow neither this
  // process nor the load on the database.
  const DM_TYPING_THREAD_LIMIT = 32;
  const DM_TYPING_LOOKUP_BUDGET = 20;
  const DM_TYPING_LOOKUP_WINDOW_MS = 30_000;

  function spendTypingLookup(connection) {
    const at = now();
    const budget = connection.dmTypingLookups;
    if (!budget || at - budget.windowAt >= DM_TYPING_LOOKUP_WINDOW_MS) {
      connection.dmTypingLookups = { windowAt: at, spent: 1 };
      return true;
    }
    if (budget.spent >= DM_TYPING_LOOKUP_BUDGET) return false;
    budget.spent += 1;
    return true;
  }

  function forwardDirectTyping(connection, peerId, activity = 'typing') {
    if (!connection.userId || peerId === connection.userId) return;
    connection.dmTypingThrottle ??= createTypingThrottle({ now });
    connection.dmTypingThrottle.offer(peerId, activity, (value) => {
      sendDirectTyping(connection, peerId, value).catch((error) => reportMessageError(error, connection, 'dm.typing'));
    });
  }

  async function sendDirectTyping(connection, peerId, activity) {
    const cache = (connection.dmTypingPermission ??= new Map());
    const entry = cache.get(peerId) || { allowed: false, checkedAt: -Infinity };
    cache.delete(peerId);
    cache.set(peerId, entry);
    while (cache.size > DM_TYPING_THREAD_LIMIT) cache.delete(cache.keys().next().value);
    if (now() - entry.checkedAt >= DM_TYPING_PERMISSION_TTL_MS) {
      if (!spendTypingLookup(connection)) return;
      entry.allowed = Boolean(await canTypeToUser(connection.userId, peerId));
      entry.checkedAt = now();
    }
    if (!entry.allowed || connection.closed) return;
    registry.sendToUser(peerId, buildServerEnvelope('dm.typing', { userId: connection.userId, activity }));
  }

  function enqueueMessage(connection, task) {
    connection.inboundMessageQueue = (connection.inboundMessageQueue || Promise.resolve())
      .then(() => {
        if (connection.closed) return;
        return task();
      })
      .catch((error) => reportMessageError(error, connection));
  }

  async function handleMessage(connection, envelope, req) {
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
      // A WebSocket can stay open while the account profile changes. Resolve the
      // session again at join time so a newly uploaded/deleted avatar is not
      // overwritten by the user snapshot captured when the socket first opened.
      const currentSession = await resolveSessionUser(req);
      if (connection.closed) return;
      const result = await roomRuntime.joinVoiceRoom(
        connection,
        envelope.payload,
        currentSession?.user || null,
        getClientIp(req),
        envelope.id
      );
      const joinRoomId = normalizeRoomId(envelope.payload.roomId);
      if (result.ok) {
        logger.info({
          evt: LOG_EVENTS.ROOM_JOINED,
          connId: connection.id,
          userId: connection.userId || undefined,
          roomId: joinRoomId,
          guest: connection.guest
        }, 'room joined');
      } else {
        logger.warn({
          evt: LOG_EVENTS.ROOM_JOIN_REJECTED,
          connId: connection.id,
          userId: connection.userId || undefined,
          roomId: joinRoomId,
          code: result.code || 'join_failed'
        }, 'room join rejected');
      }

      if (!result.ok && result.code === 'room_banned') {
        registry.sendToConnection(connection, buildServerEnvelope('room.banned', {
          roomId: envelope.payload.roomId
        }, envelope.id));
      } else if (!result.ok && result.message) {
        registry.sendToConnection(
          connection,
          buildServerErrorEnvelope(result.code || 'join_failed', result.message, envelope.id)
        );
      }
      return;
    }

    if (envelope.type === 'room.leave') {
      logger.info({
        evt: LOG_EVENTS.ROOM_LEFT,
        connId: connection.id,
        userId: connection.userId || undefined,
        roomId: normalizeRoomId(envelope.payload.roomId)
      }, 'room left');
      await roomRuntime.leaveVoiceRoom(connection, {
        roomId: normalizeRoomId(envelope.payload.roomId),
        peerId: normalizePeerId(envelope.payload.peerId),
        sessionToken: normalizeSessionToken(envelope.payload.sessionToken)
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

    if (envelope.type === 'room.chat.typing') {
      await roomRuntime.broadcastRoomTyping(
        connection,
        normalizeRoomId(envelope.payload.roomId),
        normalizeTypingActivity(envelope.payload.activity) || 'typing'
      );
      return;
    }

    if (envelope.type === 'dm.typing') {
      await forwardDirectTyping(connection, envelope.payload.userId, normalizeTypingActivity(envelope.payload.activity) || 'typing');
      return;
    }

    logger.warn({
      evt: LOG_EVENTS.WS_MESSAGE_REJECTED,
      connId: connection.id,
      userId: connection.userId || undefined,
      type: envelope.type,
      code: 'not_implemented'
    }, 'unsupported ws message type');
    registry.sendToConnection(
      connection,
      buildServerErrorEnvelope('not_implemented', `Unsupported message type: ${envelope.type}`, envelope.id)
    );
  }

  async function handleConnection(socket, req) {
    const session = await resolveSessionUser(req);
    const sessionUser = session?.user || null;

    // Check the limit before registering: adding first and then removing would
    // count the doomed connection toward the limit (off-by-one) and flap the
    // user's presence for friends when it was their first connection.
    if (sessionUser && registry.rejectOverLimit(sessionUser.id)) {
      logger.warn({
        evt: LOG_EVENTS.WS_REJECTED_OVER_LIMIT,
        userId: sessionUser.id,
        scope: 'user',
        code: 4429
      }, 'ws connection rejected over the per-user limit');
      socket.close(4429, 'Too many connections');
      return;
    }

    const guestIp = sessionUser ? '' : getClientIp(req);
    if (!sessionUser && registry.rejectGuestOverLimit(guestIp)) {
      logger.warn({
        evt: LOG_EVENTS.WS_REJECTED_OVER_LIMIT,
        ipHash: hashIp(guestIp),
        scope: 'guest',
        code: 4429
      }, 'ws connection rejected over the per-ip guest limit');
      socket.close(4429, 'Too many connections');
      return;
    }

    const clientIp = getClientIp(req);
    const connection = sessionUser
      ? registry.addConnection(sessionUser.id, socket, clientIp, sessionUser.presenceStatus, session.session?.tokenHash)
      : registry.addGuestConnection(socket, guestIp);

    logger.info({
      evt: LOG_EVENTS.WS_CONNECTED,
      connId: connection.id,
      userId: connection.userId || undefined,
      guest: connection.guest,
      ipHash: hashIp(clientIp)
    }, 'ws connected');

    if (sessionUser) {
      let friendIds = [];
      try {
        friendIds = await getFriendIds(sessionUser.id);
      } catch (error) {
        logger.error({
          evt: LOG_EVENTS.WS_FRIENDS_LOAD_FAILED,
          connId: connection.id,
          userId: sessionUser.id,
          err: error
        }, 'failed to load friends for the ws ready frame');
      }
      registry.sendReady(connection, {
        userId: sessionUser.id,
        onlineFriendIds: friendIds.filter((friendId) => isUserOnline(friendId))
      });
      void roomRuntime.sendAccountSummaries(connection, sessionUser.id);
    } else {
      registry.sendReady(connection, { guest: true });
    }

    socket.on('message', (raw) => {
      if (connection.closed) return;
      const parsed = parseInboundMessage(String(raw));
      if (!parsed.ok) {
        registry.sendToConnection(
          connection,
          buildServerErrorEnvelope(parsed.code, 'Invalid WebSocket message')
        );
        return;
      }
      if (parsed.envelope.type === 'hello' || parsed.envelope.type === 'ping') {
        // Heartbeats do not mutate room intent and must not wait behind storage.
        void handleMessage(connection, parsed.envelope, req).catch(reportMessageError);
        return;
      }

      // Preserve wire order across stateful handlers that await authorization
      // or storage. Without this queue, JOIN→LEAVE and JOIN1→JOIN2 can execute
      // in reverse before the room runtime registers their intent.
      enqueueMessage(connection, () => handleMessage(connection, parsed.envelope, req));
    });

    // The close code and how long the socket lived are what separate a normal
    // navigation (1001, minutes) from the instability being chased: an abnormal
    // 1006 seconds after connecting, repeated per user.
    socket.on('close', (code, reason) => {
      logger.info({
        evt: LOG_EVENTS.WS_CLOSED,
        connId: connection.id,
        userId: connection.userId || undefined,
        code: Number(code) || 0,
        reason: String(reason || '').slice(0, 120) || undefined,
        durationMs: now() - connection.openedAt
      }, 'ws closed');
      registry.removeConnection(connection);
    });

    socket.on('error', (error) => {
      logger.warn({
        evt: LOG_EVENTS.WS_CLOSED,
        connId: connection.id,
        userId: connection.userId || undefined,
        code: 0,
        reason: 'socket_error',
        durationMs: now() - connection.openedAt,
        err: error
      }, 'ws closed after a socket error');
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
