// Rooms over HTTP: create, rename, delete, the public status card, the peer
// preview, the account's room list, and the read-only legacy /api/state.
// Error texts are the ones the web client already shows.

import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { cleanRoomName, normalizePeerId, normalizeRoomId, normalizeSessionToken } from '@voice-room/shared/validation';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody, type Failure } from '../../platform/http/http-kit.ts';
import { publicPeer, roomAvatarUrl, roomBanned, type LiveRoom, type LobbyRoom, type PresencePeer, type StoredRoom } from './room-views.ts';
import type { OwnerCheck, RoomsService } from './rooms.service.ts';

export const FailureBody = Type.Object({
  ok: Type.Literal(false),
  error: Type.String(),
  code: Type.Optional(Type.String()),
  roomId: Type.Optional(Type.String()),
  exists: Type.Optional(Type.Boolean())
});

// Room and peer payloads are built by room-views.ts and typed there; the
// schema only frames the envelope so no field is dropped on serialisation.
const Payload = Type.Unknown();
const RoomParams = Type.Object({ roomId: Type.String() });

const OWNER_REFUSALS: Record<Exclude<OwnerCheck['status'], 'owner'>, { status: 401 | 403 | 404; body: Failure }> = {
  unauthenticated: { status: 401, body: failure('Требуется вход') },
  not_found: { status: 404, body: failure('Комната не найдена') },
  forbidden: { status: 403, body: failure('Недостаточно прав') }
};

/** The HTTP answer for a failed owner check (every room mutation starts with one). */
export function ownerRefusal(check: Exclude<OwnerCheck, { status: 'owner' }>) {
  return OWNER_REFUSALS[check.status];
}

const ROOM_NOT_FOUND = failure('Комната не найдена');
const STATIC_ROOM_NEEDS_LOGIN = failure('Требуется вход для создания постоянной комнаты');

interface RateLimiter {
  check(key: string): { allowed: boolean; retryAfterSeconds?: number };
}

interface RoomListStore {
  listVisibleRoomsForUser(userId: string): Promise<StoredRoom[]>;
  addRoomBookmarkForUser(userId: string, roomId: string): Promise<{ status: string; room?: StoredRoom }>;
  removeRoomBookmarkForUser(userId: string, roomId: string): Promise<{ status: string; removed?: boolean }>;
}

export interface RoomRoutesDeps {
  rooms: RoomsService;
  store(): RoomListStore;
  getRoom(roomId: string): Promise<LiveRoom | null>;
  findRoomBan(roomId: string, userId: string | null | undefined, ip: string): Promise<unknown>;
  /** The roster peer whose session token matches, or null. */
  findAuthorizedPeer(roomId: string, peerId: string, sessionToken: string): PresencePeer | null;
  lobbyRoom(room: StoredRoom): LobbyRoom;
  invalidateRecipientCache(roomId: string): void;
  createLimiter: RateLimiter;
  pow: { verify(ip: string, proof: unknown): { ok: boolean; status?: number; error?: string } };
  maxRooms: number;
  maxRoomPeers: number;
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

// A session token identifies the logical peer, not the current transport, so
// HTTP state writes could let a superseded tab mutate its replacement. Peer
// state changes go over the WebSocket; /api/state only reads.
const LEGACY_STATE_MUTATION_FIELDS = ['name', 'muted', 'deafened', 'screen', 'screenAudio', 'screenProfileId', 'screenStreamId', 'viewedScreenPeerId'];

export function registerRoomRoutes(root: FastifyInstance, ctx: ApiContext, deps: RoomRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  const sessionUserId = async (raw: Parameters<ApiContext['resolveSession']>[0]) => (await ctx.resolveSession(raw))?.user?.id ?? null;

  app.post('/api/rooms', {
    preValidation: optionalJsonBody,
    schema: {
      body: Type.Object({ isStatic: Type.Optional(Type.Unknown()), name: Type.Optional(Type.Unknown()), proof: Type.Optional(Type.Unknown()) }),
      response: {
        201: Type.Object({
          ok: Type.Literal(true),
          avatarUrl: Type.Null(),
          createdAt: Type.Number(),
          maxRooms: Type.Number(),
          maxRoomPeers: Type.Number(),
          isStatic: Type.Boolean(),
          name: Type.String(),
          owned: Type.Boolean(),
          roomId: Type.String()
        }),
        '4xx': FailureBody,
        503: FailureBody
      }
    }
  }, async (request, reply) => {
    const clientIp = ctx.clientIp(request.raw);
    const rate = deps.createLimiter.check(clientIp);
    if (!rate.allowed) {
      return reply.code(429).header('Retry-After', String(rate.retryAfterSeconds)).send(failure('Too many rooms created, try again later'));
    }
    const proof = deps.pow.verify(clientIp, request.body.proof);
    if (!proof.ok) return reply.code(proof.status || 400).send(failure(proof.error || 'Invalid proof'));

    const isStatic = parseBoolean(request.body.isStatic);
    // Persistent rooms belong to the account that creates them so they can be
    // listed back from any device; temporary rooms stay ownerless.
    const ownerId = isStatic ? await sessionUserId(request.raw) : null;
    if (isStatic && !ownerId) return reply.code(401).send(STATIC_ROOM_NEEDS_LOGIN);

    const created = await deps.rooms.createRoom({ creatorIp: clientIp, isStatic, ownerId, name: cleanRoomName(request.body.name) });
    if (created.status === 'auth_required') return reply.code(401).send(STATIC_ROOM_NEEDS_LOGIN);
    if (created.status === 'quota_exceeded') {
      return reply.code(429).send(failure(isStatic
        ? 'Можно владеть максимум 3 постоянными комнатами'
        : 'Too many temporary rooms waiting from this IP, reuse one or try later'));
    }
    if (created.status !== 'created') return reply.code(503).send(failure('Room capacity is temporarily full'));

    const { room } = created;
    return reply.code(201).send({
      ok: true as const,
      avatarUrl: null,
      createdAt: room.createdAt,
      maxRooms: deps.maxRooms,
      maxRoomPeers: deps.maxRoomPeers,
      isStatic: room.isStatic,
      name: room.name,
      owned: Boolean(room.ownerId),
      roomId: room.id
    });
  });

  app.put('/api/rooms/:roomId', {
    preValidation: optionalJsonBody,
    schema: {
      params: RoomParams,
      body: Type.Object({ name: Type.Optional(Type.Unknown()) }),
      response: { 200: Type.Object({ ok: Type.Literal(true), room: Payload }), '4xx': FailureBody }
    }
  }, async (request, reply) => {
    const roomId: string = normalizeRoomId(request.params.roomId);
    const check = await deps.rooms.checkOwner(await sessionUserId(request.raw), roomId);
    if (check.status !== 'owner') {
      const refusal = ownerRefusal(check);
      return reply.code(refusal.status).send(refusal.body);
    }
    const name: string = request.body.name !== undefined ? cleanRoomName(request.body.name) : check.room.name;
    if (!name) return reply.code(400).send(failure('Дайте комнате название'));
    const renamed = await deps.rooms.rename(roomId, name);
    if (renamed.status === 'not_found') return reply.code(404).send(ROOM_NOT_FOUND);
    return { ok: true as const, room: renamed.room };
  });

  app.delete('/api/rooms/:roomId', {
    schema: { params: RoomParams, response: { 200: Type.Object({ ok: Type.Literal(true) }), '4xx': FailureBody } }
  }, async (request, reply) => {
    const roomId: string = normalizeRoomId(request.params.roomId);
    const check = await deps.rooms.checkOwner(await sessionUserId(request.raw), roomId);
    if (check.status !== 'owner') {
      const refusal = ownerRefusal(check);
      return reply.code(refusal.status).send(refusal.body);
    }
    const removed = await deps.rooms.remove(roomId, request);
    if (removed.status === 'not_found') return reply.code(404).send(ROOM_NOT_FOUND);
    return { ok: true as const };
  });

  app.get('/api/rooms/:roomId', {
    schema: {
      params: RoomParams,
      response: {
        200: Type.Object({
          ok: Type.Literal(true),
          avatarUrl: Type.Union([Type.String(), Type.Null()]),
          createdAt: Type.Number(),
          exists: Type.Literal(true),
          emptySince: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
          isStatic: Type.Boolean(),
          maxRoomPeers: Type.Number(),
          name: Type.String(),
          peers: Type.Number(),
          roomId: Type.String()
        }),
        404: FailureBody
      }
    }
  }, async (request, reply) => {
    const roomId: string = normalizeRoomId(request.params.roomId);
    const notFound = { ...failure('Room not found'), exists: false };
    if (!roomId) return reply.code(404).send(notFound);
    const room = await deps.getRoom(roomId);
    if (!room) return reply.code(404).send({ ...notFound, roomId });
    return {
      ok: true as const,
      avatarUrl: roomAvatarUrl(room.avatarKey),
      createdAt: room.createdAt,
      exists: true as const,
      emptySince: room.emptySince,
      isStatic: room.isStatic,
      maxRoomPeers: deps.maxRoomPeers,
      name: room.name,
      peers: room.peers.size,
      roomId
    };
  });

  // Read-only snapshot of who is in a room: the lobby's preview of a room
  // before entering it. Creates no peer.
  app.get('/api/rooms/:roomId/peers', {
    schema: {
      params: RoomParams,
      response: { 200: Type.Object({ ok: Type.Literal(true), roomId: Type.String(), peers: Type.Array(Payload) }), '4xx': FailureBody }
    }
  }, async (request, reply) => {
    const roomId: string = normalizeRoomId(request.params.roomId);
    const room = await deps.getRoom(roomId);
    if (!room) return reply.code(404).send({ ...failure('Room not found'), roomId });
    if (await deps.findRoomBan(roomId, await sessionUserId(request.raw), ctx.clientIp(request.raw))) {
      return reply.code(403).send(roomBanned(roomId));
    }
    return { ok: true as const, roomId, peers: Array.from(room.peers.values()).map(publicPeer) };
  });

  app.post('/api/state', {
    preValidation: optionalJsonBody,
    schema: {
      body: Type.Object({ roomId: Type.Optional(Type.Unknown()), peerId: Type.Optional(Type.Unknown()), sessionToken: Type.Optional(Type.Unknown()) }),
      response: { 200: Type.Object({ ok: Type.Literal(true), peer: Payload }), '4xx': FailureBody }
    }
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const roomId: string = normalizeRoomId(body.roomId);
    const peerId: string = normalizePeerId(body.peerId);
    const sessionToken: string = normalizeSessionToken(body.sessionToken);

    // Moderation removes the peer before its next state read. Check the
    // request's own identity first so a banned client gets the stable ban
    // answer instead of the generic invalid-session one.
    if (await deps.findRoomBan(roomId, await sessionUserId(request.raw), ctx.clientIp(request.raw))) {
      return reply.code(403).send(roomBanned(roomId));
    }
    const peer = deps.findAuthorizedPeer(roomId, peerId, sessionToken);
    if (!peer) return reply.code(403).send(failure('Invalid peer session'));
    if (await deps.findRoomBan(roomId, peer.accountUserId, peer.ip || '')) return reply.code(403).send(roomBanned(roomId));

    if (LEGACY_STATE_MUTATION_FIELDS.some((field) => Object.hasOwn(body, field))) {
      return reply.code(409).send(failure('Peer state updates require the active WebSocket connection', { code: 'state_updates_require_websocket' }));
    }
    return { ok: true as const, peer: publicPeer(peer) };
  });

  app.get('/api/auth/rooms', {
    schema: { response: { 200: Type.Object({ ok: Type.Literal(true), rooms: Type.Array(Payload) }), '4xx': FailureBody } }
  }, async (request, reply) => {
    const userId = await sessionUserId(request.raw);
    if (!userId) return reply.code(401).send(failure('Требуется вход'));
    const rooms = await deps.store().listVisibleRoomsForUser(userId);
    return { ok: true as const, rooms: rooms.map(deps.lobbyRoom) };
  });

  app.post('/api/auth/rooms', {
    preValidation: optionalJsonBody,
    schema: {
      body: Type.Object({ roomId: Type.Optional(Type.Unknown()), code: Type.Optional(Type.Unknown()), roomCode: Type.Optional(Type.Unknown()) }),
      response: { 200: Type.Object({ ok: Type.Literal(true), room: Payload }), '4xx': FailureBody }
    }
  }, async (request, reply) => {
    const userId = await sessionUserId(request.raw);
    if (!userId) return reply.code(401).send(failure('Требуется вход'));
    const { body } = request;
    const roomId: string = normalizeRoomId(body.roomId || body.code || body.roomCode);
    if (!roomId) return reply.code(400).send(failure('Неверный код комнаты'));

    const added = await deps.store().addRoomBookmarkForUser(userId, roomId);
    if (added.status === 'not_found') return reply.code(404).send(ROOM_NOT_FOUND);
    if (added.status === 'temporary_room') return reply.code(400).send(failure('В список можно добавить только постоянную комнату'));
    deps.invalidateRecipientCache(roomId);
    return { ok: true as const, room: deps.lobbyRoom(added.room as StoredRoom) };
  });

  app.delete('/api/auth/rooms/:roomId', {
    schema: {
      params: RoomParams,
      response: { 200: Type.Object({ ok: Type.Literal(true), removed: Payload }), '4xx': FailureBody }
    }
  }, async (request, reply) => {
    const userId = await sessionUserId(request.raw);
    if (!userId) return reply.code(401).send(failure('Требуется вход'));
    const roomId: string = normalizeRoomId(request.params.roomId);
    if (!roomId) return reply.code(404).send(ROOM_NOT_FOUND);

    const result = await deps.store().removeRoomBookmarkForUser(userId, roomId);
    if (result.status === 'owner') {
      return reply.code(403).send(failure('Владелец управляет комнатой через настройки', { code: 'room_owner' }));
    }
    deps.invalidateRecipientCache(roomId);
    return { ok: true as const, removed: result.removed };
  });
}
