import {
  ROOM_SURFACE_CEILINGS,
  roomAllowsSurface,
  type RoomBoundary,
  type RoomSurface
} from '../domains/rooms/room-surface.policy.ts';
import type { JoinResult, JoinUser } from './voice-join.ts';
import type { IncomingMessage } from 'node:http';
import { clientKind, describeUserAgent } from '@voiceroom/shared/account-security';
import type { ErrorCode } from '@voiceroom/shared/contracts/errors';
import type { ClientCommand, ClientCommands, MediaGrant, TypingActivity } from '@voiceroom/shared/contracts/realtime';
import { buildServerEnvelope, buildServerErrorEnvelope, parseInboundMessage } from './envelope.ts';
import { createTypingThrottle } from './typing-throttle.ts';
import type { MeetChat } from './meet-chat.ts';
import type { ConnectionRegistry, RealtimeSocket, WsConnection } from './registry.ts';
import { BoundedMap } from '../lib/bounded-map.ts';
import { LOG_EVENTS } from '../lib/log-events.ts';
import { createLogger, hashIp } from '../lib/logger.ts';
import { createRateLimiter } from '../lib/rate-limit.ts';
import type { Logger } from '../platform/types.ts';
import type { ResolvedSession, SessionUser } from '../app/context.ts';
import { DomainError } from '../platform/http/domain-error.ts';

// Validated commands always carry a payload object.
type InboundEnvelope = ClientCommand;
/** What the socket reads of the signed-in account: what a join reads, and its presence. */
type WsUser = NonNullable<JoinUser> & Partial<Pick<SessionUser, 'presenceStatus'>>;
export interface WsRoomRuntime {
  isCallRoom?(roomId: string): boolean;
  subscribePreview(connection: WsConnection, roomId: string): Promise<unknown>;
  unsubscribePreview(connection: WsConnection, roomId: string): unknown;
  joinVoiceRoom(
    connection: WsConnection,
    payload: ClientCommands['room.join'],
    user: WsUser | null,
    clientIp: string,
    requestId?: string
  ): Promise<JoinResult>;
  leaveVoiceRoom(connection: WsConnection, target: ClientCommands['room.leave']): Promise<unknown>;
  updatePeerState(
    connection: WsConnection,
    payload: ClientCommands['room.peer.update']
  ): Promise<{ ok: true } | { ok: false; code: ErrorCode }>;
  reportVoice(
    connection: WsConnection,
    payload: ClientCommands['room.voice.report']
  ): { ok: true } | { ok: false; code: ErrorCode };
  requestMedia(
    connection: WsConnection,
    payload: ClientCommands['room.media.request']
  ): { ok: true; grant: MediaGrant } | { ok: false; code: ErrorCode };
  broadcastRoomTyping?(connection: WsConnection, roomId: string, activity: TypingActivity): unknown;
  sendAccountSummaries?(connection: WsConnection, userId: string): Promise<unknown>;
}
type WsSocket = RealtimeSocket & {
  on(event: 'message', listener: (raw: unknown) => void): unknown;
  on(event: 'close', listener: (code: number, reason: unknown) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
};

// A client opens with hello, its restored subscriptions and whatever it queued
// offline; more than this before the session resolves is not a client.
const MAX_EARLY_FRAMES = 64;
const MAX_PENDING_MEET_COMMANDS = 32;
const GUEST_COMMANDS = new Set<ClientCommand['type']>([
  'hello',
  'ping',
  'room.join',
  'room.leave',
  'room.peer.update',
  'room.voice.report',
  'room.media.request'
]);

// ws hands the close reason over as a Buffer; tests and fakes may pass text.
function closeReasonText(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  return Buffer.isBuffer(reason) ? reason.toString() : '';
}

function createWsHandler({
  registry,
  roomRuntime,
  joinCallVoice,
  surface = 'main',
  meetChat,
  getBoundary,
  widgetAdmissionEnabled,
  widgetLocalAllowed,
  resolveSessionUser = async () => null,
  getFriendIds = async () => [],
  isUserOnline = () => false,
  canTypeToUser = async () => false,
  getClientIp,
  now = Date.now,
  logger = createLogger({ name: 'api' })
}: {
  registry: ConnectionRegistry;
  surface?: RoomSurface;
  meetChat?: MeetChat;
  getBoundary?: (roomId: string) => Promise<RoomBoundary | null>;
  widgetAdmissionEnabled?: () => Promise<boolean>;
  widgetLocalAllowed?: () => boolean;
  roomRuntime: WsRoomRuntime;
  joinCallVoice?:
    | ((
        connection: WsConnection,
        auth: ResolvedSession,
        callId: string,
        proof: string,
        ip: string,
        requestId?: string
      ) => Promise<JoinResult>)
    | undefined;
  resolveSessionUser?: (req: IncomingMessage) => Promise<ResolvedSession | null>;
  getFriendIds?: (userId: string) => Promise<string[]>;
  isUserOnline?: (userId: string) => boolean;
  canTypeToUser?: (userId: string, peerId: string) => Promise<unknown>;
  getClientIp?: ((req: IncomingMessage) => string) | undefined;
  now?: () => number;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
}) {
  const ceiling = ROOM_SURFACE_CEILINGS[surface];
  const meetQueues = new WeakMap<WsConnection, { pending: number; overflowed: boolean }>();
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
        err: ceiling.guestOnly ? undefined : error
      },
      'ws message handler failed'
    );
  }

  // Direct typing follows the message policy. The check is cached per connection and thread for a short while so
  // a burst of typing costs one lookup, and notices to a thread go through the
  // typing throttle.
  const DM_TYPING_PERMISSION_TTL_MS = 30_000;
  // The client picks the thread ids, so the cache and the lookups behind it are
  // bounded per connection: naming endless strangers can grow neither this
  // process nor the load on the database.
  const DM_TYPING_THREAD_LIMIT = 32;
  const DM_TYPING_LOOKUP_BUDGET = 20;
  const DM_TYPING_LOOKUP_WINDOW_MS = 30_000;

  function forwardDirectTyping(connection: WsConnection, peerId: string, activity: TypingActivity = 'typing'): void {
    const { userId } = connection;
    if (!userId || peerId === userId) return;
    connection.dmTypingThrottle ??= createTypingThrottle<TypingActivity>({ now });
    connection.dmTypingThrottle.offer(peerId, activity, (value: TypingActivity) => {
      sendDirectTyping(connection, userId, peerId, value).catch((error: unknown) =>
        reportMessageError(error, connection, 'dm.typing')
      );
    });
  }

  async function sendDirectTyping(
    connection: WsConnection,
    userId: string,
    peerId: string,
    activity: TypingActivity
  ): Promise<void> {
    const cache = (connection.dmTypingPermission ??= new BoundedMap(DM_TYPING_THREAD_LIMIT));
    const entry = cache.get(peerId) || { allowed: false, checkedAt: -Infinity };
    cache.set(peerId, entry);
    if (now() - entry.checkedAt >= DM_TYPING_PERMISSION_TTL_MS) {
      const lookups = (connection.dmTypingLookups ??= createRateLimiter({
        limit: DM_TYPING_LOOKUP_BUDGET,
        windowMs: DM_TYPING_LOOKUP_WINDOW_MS
      }));
      if (!lookups.check(userId, now()).allowed) return;
      entry.allowed = Boolean(await canTypeToUser(userId, peerId));
      entry.checkedAt = now();
      if (cache.get(peerId) !== entry) return;
    }
    if (!entry.allowed || connection.closed) return;
    registry.sendToUser(peerId, buildServerEnvelope('dm.typing', { userId, activity }));
  }

  function enqueueMessage(connection: WsConnection, type: string, task: () => Promise<unknown>): void {
    connection.inboundMessageQueue = connection.inboundMessageQueue
      .then(() => {
        if (connection.closed) return;
        return task();
      })
      .catch((error: unknown) => reportMessageError(error, connection, type));
  }

  async function handleMessage(
    connection: WsConnection,
    envelope: InboundEnvelope,
    req: IncomingMessage
  ): Promise<void> {
    if (
      ceiling.requiresWidgetOwner &&
      envelope.type === 'room.join' &&
      widgetAdmissionEnabled &&
      !(await widgetAdmissionEnabled())
    ) {
      registry.sendToConnection(connection, buildServerErrorEnvelope('room_not_found', 'Room not found', envelope.id));
      return;
    }
    if (ceiling.guestOnly && !GUEST_COMMANDS.has(envelope.type) && envelope.type !== 'meet.chat.send') {
      registry.sendToConnection(connection, buildServerErrorEnvelope('forbidden', 'Command unavailable', envelope.id));
      return;
    }
    const active = connection.activeVoice;
    const existingSeatCommand =
      surface === 'main' &&
      !connection.guest &&
      active !== null &&
      (envelope.type === 'room.leave' ||
        envelope.type === 'room.peer.update' ||
        envelope.type === 'room.media.request' ||
        envelope.type === 'room.voice.report') &&
      active.roomId === envelope.payload.roomId &&
      active.peerId === envelope.payload.peerId &&
      active.sessionToken === envelope.payload.sessionToken;
    const callLeave =
      envelope.type === 'room.leave' &&
      existingSeatCommand &&
      roomRuntime.isCallRoom?.(envelope.payload.roomId) === true;
    if ('roomId' in envelope.payload && getBoundary && !callLeave) {
      const boundary = await getBoundary(envelope.payload.roomId);
      if (!roomAllowsSurface(boundary, surface) && !(boundary?.kind === 'call' && existingSeatCommand)) {
        if (
          envelope.type === 'room.leave' &&
          surface === 'main' &&
          !connection.guest &&
          (!boundary || boundary.kind === 'call')
        )
          return;
        registry.sendToConnection(
          connection,
          buildServerErrorEnvelope('room_not_found', 'Room not found', envelope.id)
        );
        return;
      }
    }
    if (
      !ceiling.screenShare &&
      ((envelope.type === 'room.media.request' && envelope.payload.kind === 'screen') ||
        (envelope.type === 'room.peer.update' &&
          ['screen', 'screenAudio', 'screenProfileId', 'screenStreamId', 'viewedScreenPeerId'].some((key) =>
            Object.hasOwn(envelope.payload.patch, key)
          )))
    ) {
      registry.sendToConnection(
        connection,
        buildServerErrorEnvelope('forbidden', 'Screen sharing unavailable', envelope.id)
      );
      return;
    }
    if (
      !ceiling.camera &&
      ((envelope.type === 'room.media.request' && envelope.payload.kind === 'camera') ||
        (envelope.type === 'room.peer.update' && Object.hasOwn(envelope.payload.patch, 'camera')))
    ) {
      registry.sendToConnection(connection, buildServerErrorEnvelope('forbidden', 'Camera unavailable', envelope.id));
      return;
    }
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
        await roomRuntime.subscribePreview(connection, envelope.payload.roomId);
        return;
      }

      case 'room.preview.unsubscribe': {
        roomRuntime.unsubscribePreview(connection, envelope.payload.roomId);
        return;
      }

      case 'call.voice.join': {
        const auth = joinCallVoice && surface === 'main' && !connection.guest ? await resolveSessionUser(req) : null;
        if (connection.closed) return;
        let result: JoinResult = { ok: false, code: 'call_not_found' };
        if (joinCallVoice && auth) {
          try {
            result = await joinCallVoice(
              connection,
              auth,
              envelope.payload.callId,
              envelope.payload.seatToken,
              getClientIp?.(req) ?? '',
              envelope.id
            );
          } catch (error) {
            if (!(error instanceof DomainError)) throw error;
            result = { ok: false, code: error.code, message: error.message };
          }
        }
        if (!result.ok) {
          registry.sendToConnection(
            connection,
            buildServerErrorEnvelope(result.code, result.message ?? 'Call voice join refused', envelope.id)
          );
        }
        return;
      }

      case 'room.join': {
        // A WebSocket can stay open while the account profile changes. Resolve the
        // session again at join time so a newly uploaded/deleted avatar is not
        // overwritten by the user snapshot captured when the socket first opened.
        const currentSession = ceiling.guestOnly ? null : await resolveSessionUser(req);
        if (connection.closed) return;
        const result = await roomRuntime.joinVoiceRoom(
          connection,
          envelope.payload,
          currentSession?.user || null,
          getClientIp?.(req) ?? '',
          envelope.id
        );
        const joinRoomId = envelope.payload.roomId;
        if (result.ok) {
          logger.info(
            {
              evt: LOG_EVENTS.ROOM_JOINED,
              connId: connection.id,
              userId: connection.userId || undefined,
              roomId: ceiling.guestOnly ? undefined : joinRoomId,
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
              roomId: ceiling.guestOnly ? undefined : joinRoomId,
              code: result.code
            },
            'room join rejected'
          );
        }

        if (!result.ok && result.code === 'room_banned') {
          registry.sendToConnection(
            connection,
            buildServerEnvelope('room.banned', { roomId: envelope.payload.roomId }, envelope.id)
          );
        } else if (!result.ok && result.message) {
          registry.sendToConnection(connection, buildServerErrorEnvelope(result.code, result.message, envelope.id));
        }
        return;
      }

      case 'room.leave': {
        logger.info(
          {
            evt: LOG_EVENTS.ROOM_LEFT,
            connId: callLeave ? undefined : connection.id,
            userId: callLeave ? undefined : connection.userId || undefined,
            roomId: callLeave || ceiling.guestOnly ? undefined : envelope.payload.roomId
          },
          'room left'
        );
        await roomRuntime.leaveVoiceRoom(connection, envelope.payload);
        return;
      }

      case 'room.peer.update': {
        const result = await roomRuntime.updatePeerState(connection, envelope.payload);
        if (!result.ok) {
          registry.sendToConnection(
            connection,
            buildServerErrorEnvelope(result.code, 'Peer update rejected', envelope.id)
          );
        }
        return;
      }

      // A poll that lost the race with a leave or a rejoin is dropped: the
      // next one comes from the new seat within seconds.
      case 'room.voice.report':
        roomRuntime.reportVoice(connection, envelope.payload);
        return;

      case 'room.media.request': {
        const result = roomRuntime.requestMedia(connection, envelope.payload);
        if (!result.ok) {
          registry.sendToConnection(
            connection,
            buildServerErrorEnvelope(result.code, 'Media request rejected', envelope.id)
          );
          return;
        }
        if (!result.grant.granted) {
          logger.info(
            {
              evt: LOG_EVENTS.ROOM_MEDIA_REFUSED,
              connId: connection.id,
              roomId: ceiling.guestOnly ? undefined : result.grant.roomId,
              kind: result.grant.kind,
              reason: result.grant.reason
            },
            'media request refused'
          );
        }
        registry.sendToConnection(connection, buildServerEnvelope('room.media.grant', result.grant, envelope.id));
        return;
      }

      case 'room.chat.typing': {
        await roomRuntime.broadcastRoomTyping?.(
          connection,
          envelope.payload.roomId,
          envelope.payload.activity ?? 'typing'
        );
        return;
      }

      case 'meet.chat.send': {
        const code = surface === 'meet' && meetChat ? meetChat(connection, envelope.payload.text) : 'forbidden';
        if (code)
          registry.sendToConnection(connection, buildServerErrorEnvelope(code, 'Chat send refused', envelope.id));
        return;
      }

      case 'dm.typing': {
        forwardDirectTyping(connection, envelope.payload.userId, envelope.payload.activity ?? 'typing');
        return;
      }
    }
  }

  async function handleConnection(socket: WsSocket, req: IncomingMessage): Promise<void> {
    // The client speaks as soon as its socket opens (hello, the subscriptions
    // it restores after a reconnect, commands queued while offline), and the
    // session lookup below takes a database round trip. The listeners go on
    // first, so nothing that arrives meanwhile is dropped: frames wait until
    // the connection is registered and has its ready frame, and a socket that
    // closes in that window is never registered at all.
    let connection: WsConnection | null = null;
    let early: unknown[] | null = [];
    let endedEarly = false;

    socket.on('message', (raw: unknown) => {
      if (early) {
        if (early.length >= MAX_EARLY_FRAMES) {
          socket.close(1008, 'Too many frames before ready');
          return;
        }
        early.push(raw);
        return;
      }
      if (connection) handleRaw(connection, raw, req);
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
      if (closeReported || !connection) return;
      closeReported = true;
      logger[error ? 'warn' : 'info'](
        {
          evt: LOG_EVENTS.WS_CLOSED,
          connId: connection.id,
          userId: connection.userId || undefined,
          code: Number(code) || 0,
          reason: ceiling.guestOnly ? undefined : closeReasonText(reason).slice(0, 120) || undefined,
          durationMs: now() - connection.openedAt,
          err: ceiling.guestOnly ? undefined : error || undefined
        },
        error ? 'ws closed after a socket error' : 'ws closed'
      );
    }

    socket.on('close', (code: number, reason: unknown) => {
      endedEarly = true;
      reportClosed({ code, reason });
      registry.removeConnection(connection);
    });

    socket.on('error', (error: Error) => {
      endedEarly = true;
      reportClosed({ reason: 'socket_error', error });
      registry.removeConnection(connection);
    });

    // The route fires this without awaiting it, so nothing past this point may
    // reject: an unhandled rejection ends the process and every call on it. A
    // failed session lookup (a pool timeout) costs only this socket.
    try {
      const session = ceiling.guestOnly ? null : await resolveSessionUser(req);
      if (endedEarly) return;
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

      const clientIp = getClientIp?.(req) ?? '';
      const guestIp = sessionUser ? '' : clientIp || 'unknown';
      if (!sessionUser && registry.rejectGuestOverLimit(guestIp)) {
        logger.warn(
          {
            evt: LOG_EVENTS.WS_REJECTED_OVER_LIMIT,
            ipHash: clientIp ? hashIp(clientIp) : undefined,
            scope: 'guest',
            code: 4429
          },
          getClientIp ? 'ws connection rejected over the per-ip guest limit' : 'ws guest connection limit reached'
        );
        socket.close(4429, 'Too many connections');
        return;
      }

      if (ceiling.requiresWidgetOwner && widgetLocalAllowed && !widgetLocalAllowed()) {
        socket.close(1008, 'Widget unavailable');
        return;
      }
      const opened = sessionUser
        ? registry.addConnection(
            sessionUser.id,
            socket,
            clientIp,
            sessionUser.presenceStatus,
            session?.session?.tokenHash
          )
        : registry.addGuestConnection(socket, guestIp);
      opened.roomSurface = surface;
      connection = opened;
      if (getClientIp) {
        opened.client = clientKind(req.headers?.['user-agent']);
        const described = describeUserAgent(req.headers?.['user-agent']);
        opened.device = { os: described.os, browser: described.client };
      }

      logger.info(
        {
          evt: LOG_EVENTS.WS_CONNECTED,
          connId: opened.id,
          userId: opened.userId || undefined,
          guest: opened.guest,
          ipHash: clientIp ? hashIp(clientIp) : undefined
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
              connId: opened.id,
              userId: sessionUser.id,
              err: error
            },
            'failed to load friends for the ws ready frame'
          );
        }
        if (opened.closed) return;
        registry.sendReady(opened, {
          userId: sessionUser.id,
          onlineFriendIds: friendIds.filter((friendId) => isUserOnline(friendId))
        });
        void roomRuntime.sendAccountSummaries?.(opened, sessionUser.id);
      } else {
        registry.sendReady(opened, { guest: true });
      }

      const waiting = early;
      early = null;
      for (const raw of waiting) handleRaw(opened, raw, req);
    } catch (error) {
      logger.error(
        {
          evt: LOG_EVENTS.WS_CONNECT_FAILED,
          connId: connection?.id,
          userId: connection?.userId || undefined,
          err: ceiling.guestOnly ? undefined : error
        },
        'ws connection setup failed'
      );
      socket.close(1011, 'Connection setup failed');
    }
  }

  function handleRaw(connection: WsConnection, raw: unknown, req: IncomingMessage): void {
    if (connection.closed) return;
    const parsed = parseInboundMessage(String(raw));
    if (!parsed.ok) {
      registry.sendToConnection(connection, buildServerErrorEnvelope(parsed.code, 'Invalid WebSocket message'));
      return;
    }
    if (parsed.envelope.type === 'hello' || parsed.envelope.type === 'ping') {
      // Heartbeats do not mutate room intent and must not wait behind storage.
      void handleMessage(connection, parsed.envelope, req).catch((error: unknown) =>
        reportMessageError(error, connection, parsed.envelope.type)
      );
      return;
    }

    // Preserve wire order across stateful handlers that await authorization
    // or storage. Without this queue, JOIN→LEAVE and JOIN1→JOIN2 can execute
    // in reverse before the room runtime registers their intent.
    const envelope = parsed.envelope;
    if (surface === 'meet') {
      const queue = meetQueues.get(connection) ?? { pending: 0, overflowed: false };
      if (queue.overflowed) return;
      if (queue.pending >= MAX_PENDING_MEET_COMMANDS) {
        queue.overflowed = true;
        connection.socket.close(1008, 'Too many pending commands');
        return;
      }
      queue.pending += 1;
      meetQueues.set(connection, queue);
      enqueueMessage(connection, envelope.type, async () => {
        try {
          if (!queue.overflowed) await handleMessage(connection, envelope, req);
        } finally {
          queue.pending -= 1;
        }
      });
      return;
    }
    enqueueMessage(connection, envelope.type, () => handleMessage(connection, envelope, req));
  }

  function invalidateTyping(userId: string, peerId?: string) {
    for (const connection of registry.allConnections()) {
      if (connection.userId === userId) {
        if (peerId) connection.dmTypingPermission?.delete(peerId);
        else connection.dmTypingPermission?.clear();
      } else if (!peerId || connection.userId === peerId) {
        connection.dmTypingPermission?.delete(userId);
      }
    }
  }

  return { handleConnection, invalidateTyping };
}

export type WsHandler = ReturnType<typeof createWsHandler>;

export { createWsHandler };
