import type { JoinPayload } from './voice-join.ts';
import type { PeerUpdatePayload } from './room-runtime.ts';
import { normalizePeerId, normalizeRoomId, normalizeSessionToken } from '@voice-room/shared/validation';
import { normalizeTypingActivity } from '@voice-room/shared/realtime';
import type { IncomingMessage } from 'node:http';
import type { TypingActivity } from '@voice-room/shared/realtime';
import type { ClientCommand } from '@voice-room/shared/contracts/realtime';
import { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage } from './envelope.ts';
import { createTypingThrottle } from './typing-throttle.ts';
import type { ConnectionRegistry, RealtimeSocket, WsConnection } from './registry.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger, hashIp } from '../lib/logger.ts';

// Validated commands always carry a payload object.
type InboundEnvelope = ClientCommand;
type SessionUser = { id: string; presenceStatus?: unknown; [key: string]: unknown };
type ResolvedSession = { user?: SessionUser | null; session?: { tokenHash?: string } | null } | null | undefined;
type JoinResult = { ok: boolean; code?: string; message?: string };
export interface WsRoomRuntime {
  subscribePreview(connection: WsConnection, roomId: string): Promise<unknown>;
  unsubscribePreview(connection: WsConnection, roomId: string): unknown;
  joinVoiceRoom(
    connection: WsConnection,
    payload: JoinPayload,
    user: SessionUser | null,
    clientIp: string,
    requestId?: string
  ): Promise<JoinResult>;
  leaveVoiceRoom(
    connection: WsConnection,
    target: { roomId: string; peerId: string; sessionToken: string }
  ): Promise<unknown>;
  updatePeerState(connection: WsConnection, payload: PeerUpdatePayload): Promise<{ ok: boolean; code?: string }>;
  broadcastRoomTyping(connection: WsConnection, roomId: string, activity: TypingActivity): unknown;
  sendAccountSummaries(connection: WsConnection, userId: string): Promise<unknown>;
}
type WsLogger = { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
type WsSocket = RealtimeSocket & {
  on(event: 'message', listener: (raw: unknown) => void): unknown;
  on(event: 'close', listener: (code: number, reason: unknown) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
};

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
}: {
  registry: ConnectionRegistry;
  roomRuntime: WsRoomRuntime;
  resolveSessionUser: (req: IncomingMessage) => Promise<ResolvedSession>;
  getFriendIds: (userId: string) => Promise<string[]>;
  isUserOnline: (userId: string) => boolean;
  canTypeToUser?: (userId: string, peerId: string) => Promise<unknown>;
  getClientIp?: (req: IncomingMessage) => string;
  now?: () => number;
  logger?: WsLogger;
}) {
  // Every realtime failure is attributed to the connection and the message type
  // that caused it. Without both, a report of "the call keeps dropping" leaves
  // nothing to search: the socket is gone and the stack alone names no user.
  function reportMessageError(error: unknown, connection: WsConnection | null = null, type = ''): void {
    logger.error(
      {
        evt: LOG_EVENTS.WS_MESSAGE_FAILED,
        connId: connection?.id,
        userId: connection?.userId || undefined,
        type: type || undefined,
        err: error
      },
      'ws message handler failed'
    );
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

  function spendTypingLookup(connection: WsConnection): boolean {
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

  function forwardDirectTyping(connection: WsConnection, peerId: string, activity: TypingActivity = 'typing'): void {
    const { userId } = connection;
    if (!userId || peerId === userId) return;
    const sender = connection as WsConnection & { userId: string };
    connection.dmTypingThrottle ??= createTypingThrottle<TypingActivity>({ now });
    connection.dmTypingThrottle.offer(peerId, activity, (value: TypingActivity) => {
      sendDirectTyping(sender, peerId, value).catch((error) => reportMessageError(error, connection, 'dm.typing'));
    });
  }

  async function sendDirectTyping(
    connection: WsConnection & { userId: string },
    peerId: string,
    activity: TypingActivity
  ): Promise<void> {
    const cache: Map<string, { allowed: boolean; checkedAt: number }> = (connection.dmTypingPermission ??= new Map());
    const entry = cache.get(peerId) || { allowed: false, checkedAt: -Infinity };
    cache.delete(peerId);
    cache.set(peerId, entry);
    while (cache.size > DM_TYPING_THREAD_LIMIT) cache.delete(cache.keys().next().value as string);
    if (now() - entry.checkedAt >= DM_TYPING_PERMISSION_TTL_MS) {
      if (!spendTypingLookup(connection)) return;
      entry.allowed = Boolean(await canTypeToUser(connection.userId, peerId));
      entry.checkedAt = now();
    }
    if (!entry.allowed || connection.closed) return;
    registry.sendToUser(peerId, buildServerEnvelope('dm.typing', { userId: connection.userId, activity }));
  }

  function enqueueMessage(connection: WsConnection, task: () => Promise<unknown>): void {
    connection.inboundMessageQueue = (connection.inboundMessageQueue || Promise.resolve())
      .then(() => {
        if (connection.closed) return;
        return task();
      })
      .catch((error) => reportMessageError(error, connection));
  }

  async function handleMessage(
    connection: WsConnection,
    envelope: InboundEnvelope,
    req: IncomingMessage
  ): Promise<void> {
    switch (envelope.type) {
      case 'hello': {
        registry.touch(connection);
        return;
      }

      case 'ping': {
        registry.touch(connection);
        registry.sendToConnection(connection, buildServerEnvelope('pong', { at: envelope.payload.at }, envelope.id));
        return;
      }

      case 'room.preview.subscribe': {
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

      case 'room.preview.unsubscribe': {
        const roomId = normalizeRoomId(envelope.payload.roomId);
        if (roomId) roomRuntime.unsubscribePreview(connection, roomId);
        return;
      }

      case 'room.join': {
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
          logger.info(
            {
              evt: LOG_EVENTS.ROOM_JOINED,
              connId: connection.id,
              userId: connection.userId || undefined,
              roomId: joinRoomId,
              guest: connection.guest
            },
            'room joined'
          );
        } else {
          logger.warn(
            {
              evt: LOG_EVENTS.ROOM_JOIN_REJECTED,
              connId: connection.id,
              userId: connection.userId || undefined,
              roomId: joinRoomId,
              code: result.code || 'join_failed'
            },
            'room join rejected'
          );
        }

        if (!result.ok && result.code === 'room_banned') {
          registry.sendToConnection(
            connection,
            buildServerEnvelope(
              'room.banned',
              {
                roomId: envelope.payload.roomId
              },
              envelope.id
            )
          );
        } else if (!result.ok && result.message) {
          registry.sendToConnection(
            connection,
            buildServerErrorEnvelope(result.code || 'join_failed', result.message, envelope.id)
          );
        }
        return;
      }

      case 'room.leave': {
        logger.info(
          {
            evt: LOG_EVENTS.ROOM_LEFT,
            connId: connection.id,
            userId: connection.userId || undefined,
            roomId: normalizeRoomId(envelope.payload.roomId)
          },
          'room left'
        );
        await roomRuntime.leaveVoiceRoom(connection, {
          roomId: normalizeRoomId(envelope.payload.roomId),
          peerId: normalizePeerId(envelope.payload.peerId),
          sessionToken: normalizeSessionToken(envelope.payload.sessionToken)
        });
        return;
      }

      case 'room.peer.update': {
        const result = await roomRuntime.updatePeerState(connection, envelope.payload);
        if (!result.ok) {
          registry.sendToConnection(
            connection,
            buildServerErrorEnvelope(result.code || 'update_failed', 'Peer update rejected', envelope.id)
          );
        }
        return;
      }

      case 'room.chat.typing': {
        await roomRuntime.broadcastRoomTyping(
          connection,
          normalizeRoomId(envelope.payload.roomId),
          normalizeTypingActivity(envelope.payload.activity) || 'typing'
        );
        return;
      }

      case 'dm.typing': {
        await forwardDirectTyping(
          connection,
          envelope.payload.userId,
          normalizeTypingActivity(envelope.payload.activity) || 'typing'
        );
        return;
      }
    }
  }

  async function handleConnection(socket: WsSocket, req: IncomingMessage): Promise<void> {
    const session = await resolveSessionUser(req);
    const sessionUser = session?.user || null;

    // Check the limit before registering: adding first and then removing would
    // count the doomed connection toward the limit (off-by-one) and flap the
    // user's presence for friends when it was their first connection.
    if (sessionUser && registry.rejectOverLimit(sessionUser.id)) {
      logger.warn(
        {
          evt: LOG_EVENTS.WS_REJECTED_OVER_LIMIT,
          userId: sessionUser.id,
          scope: 'user',
          code: 4429
        },
        'ws connection rejected over the per-user limit'
      );
      socket.close(4429, 'Too many connections');
      return;
    }

    const guestIp = sessionUser ? '' : getClientIp(req);
    if (!sessionUser && registry.rejectGuestOverLimit(guestIp)) {
      logger.warn(
        {
          evt: LOG_EVENTS.WS_REJECTED_OVER_LIMIT,
          ipHash: hashIp(guestIp),
          scope: 'guest',
          code: 4429
        },
        'ws connection rejected over the per-ip guest limit'
      );
      socket.close(4429, 'Too many connections');
      return;
    }

    const clientIp = getClientIp(req);
    const connection = sessionUser
      ? registry.addConnection(
          sessionUser.id,
          socket,
          clientIp,
          sessionUser.presenceStatus,
          session?.session?.tokenHash
        )
      : registry.addGuestConnection(socket, guestIp);

    logger.info(
      {
        evt: LOG_EVENTS.WS_CONNECTED,
        connId: connection.id,
        userId: connection.userId || undefined,
        guest: connection.guest,
        ipHash: hashIp(clientIp)
      },
      'ws connected'
    );

    if (sessionUser) {
      let friendIds: string[] = [];
      try {
        friendIds = await getFriendIds(sessionUser.id);
      } catch (error) {
        logger.error(
          {
            evt: LOG_EVENTS.WS_FRIENDS_LOAD_FAILED,
            connId: connection.id,
            userId: sessionUser.id,
            err: error
          },
          'failed to load friends for the ws ready frame'
        );
      }
      registry.sendReady(connection, {
        userId: sessionUser.id,
        onlineFriendIds: friendIds.filter((friendId) => isUserOnline(friendId))
      });
      void roomRuntime.sendAccountSummaries(connection, sessionUser.id);
    } else {
      registry.sendReady(connection, { guest: true });
    }

    socket.on('message', (raw: unknown) => {
      if (connection.closed) return;
      const parsed = parseInboundMessage(String(raw));
      if (!parsed.ok) {
        registry.sendToConnection(connection, buildServerErrorEnvelope(parsed.code, 'Invalid WebSocket message'));
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
      const envelope = parsed.envelope;
      enqueueMessage(connection, () => handleMessage(connection, envelope, req));
    });

    // The close code and how long the socket lived are what separate a normal
    // navigation (1001, minutes) from the instability being chased: an abnormal
    // 1006 seconds after connecting, repeated per user.
    // A socket error is followed by its own 'close', so the record is emitted
    // once: counting ws.closed must equal the number of sockets that ended,
    // not the number of ways each one ended.
    let closeReported = false;
    function reportClosed({
      code = 0,
      reason = '',
      error = null
    }: { code?: unknown; reason?: unknown; error?: unknown } = {}): void {
      if (closeReported) return;
      closeReported = true;
      logger[error ? 'warn' : 'info'](
        {
          evt: LOG_EVENTS.WS_CLOSED,
          connId: connection.id,
          userId: connection.userId || undefined,
          code: Number(code) || 0,
          reason: String(reason || '').slice(0, 120) || undefined,
          durationMs: now() - connection.openedAt,
          err: error || undefined
        },
        error ? 'ws closed after a socket error' : 'ws closed'
      );
    }

    socket.on('close', (code: number, reason: unknown) => {
      reportClosed({ code, reason });
      registry.removeConnection(connection);
    });

    socket.on('error', (error: Error) => {
      reportClosed({ reason: 'socket_error', error });
      registry.removeConnection(connection);
    });
  }

  return {
    handleConnection
  };
}

export type WsHandler = ReturnType<typeof createWsHandler>;

export { createWsHandler };
