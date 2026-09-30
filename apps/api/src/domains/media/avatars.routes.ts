/// <reference types="@fastify/multipart" />
// Avatar uploads (multipart field "avatar", at most 5 MB) for the account and
// for rooms the caller owns, and the immutable image files themselves.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorCode } from '@voice-room/shared/contracts/errors';
import { SignedIn } from '@voice-room/shared/contracts/account';
import { Failure, RoomIdParams } from '@voice-room/shared/contracts/http';
import { ImageKeyParams } from '@voice-room/shared/contracts/media';
import { RoomCard, RoomFailure } from '@voice-room/shared/contracts/rooms';
import { normalizeRoomId } from '@voice-room/shared/validation';
import type { ApiContext } from '../../app/context.ts';
import { MAX_AVATAR_BYTES } from '../../lib/avatar-processing.ts';
import { failure } from '../../platform/http/http-kit.ts';
import { ownerRefusal } from '../rooms/rooms.routes.ts';
import type { RoomsService } from '../rooms/rooms.service.ts';
import type { AvatarsService, AvatarUser } from './avatars.service.ts';

const UserAnswers = { 200: SignedIn, '4xx': Failure };
const RoomAnswers = { 200: RoomCard, '4xx': RoomFailure };
const TOO_LARGE = 'Avatar file must be at most 5 MB';

function httpError(statusCode: number, code: ErrorCode, message: string): Error {
  return Object.assign(new Error(message), { statusCode, code });
}

function isTooLarge(error: unknown): boolean {
  const cause = error as { code?: string; statusCode?: number } | null;
  return cause?.code === 'FST_REQ_FILE_TOO_LARGE' || cause?.statusCode === 413;
}

// Multipart errors surface as the failure answer with their own status.
export async function readAvatarUpload(request: FastifyRequest): Promise<Buffer> {
  let part;
  try {
    part = await request.file({ limits: { fileSize: MAX_AVATAR_BYTES, files: 1 } });
  } catch (cause) {
    if (isTooLarge(cause)) throw httpError(413, 'avatar_too_large', TOO_LARGE);
    throw cause;
  }
  if (!part || part.fieldname !== 'avatar') {
    part?.file?.resume?.();
    throw httpError(400, 'avatar_field_required', 'Multipart field "avatar" is required');
  }
  try {
    const buffer = await part.toBuffer();
    if (part.file?.truncated) throw httpError(413, 'avatar_too_large', TOO_LARGE);
    return buffer;
  } catch (cause) {
    if (isTooLarge(cause)) throw httpError(413, 'avatar_too_large', TOO_LARGE);
    throw cause;
  }
}

export interface AvatarRoutesDeps {
  avatars: AvatarsService;
  rooms: RoomsService;
  uploadLimiter: { check(key: string): { allowed: boolean; retryAfterSeconds?: number } };
}

export function registerAvatarRoutes(
  root: FastifyInstance,
  ctx: ApiContext,
  { avatars, rooms, uploadLimiter }: AvatarRoutesDeps
): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  async function signedIn(request: FastifyRequest, reply: FastifyReply): Promise<AvatarUser | null> {
    const user = (await ctx.resolveSession(request.raw))?.user;
    if (user) return user as AvatarUser;
    reply.code(401).send(failure('Требуется вход', { code: 'authentication_required' }));
    return null;
  }

  /** Answers 429 itself and returns false once the owner's upload budget is spent. */
  function withinUploadLimit(reply: FastifyReply, ownerId: string): boolean {
    const rate = uploadLimiter.check(`avatar:${ownerId}`);
    if (!rate.allowed) {
      reply
        .code(429)
        .header('Retry-After', String(rate.retryAfterSeconds))
        .send(failure('Слишком много загрузок, попробуйте позже', { code: 'upload_rate_limited' }));
    }
    return rate.allowed;
  }

  async function ownedRoom(rawRoomId: string, request: FastifyRequest, reply: FastifyReply) {
    const userId = (await ctx.resolveSession(request.raw))?.user?.id ?? null;
    const check = await rooms.checkOwner(userId, normalizeRoomId(rawRoomId));
    if (check.status === 'owner') return check.room;
    const refusal = ownerRefusal(check);
    reply.code(refusal.status).send(refusal.body);
    return null;
  }

  app.post('/api/auth/avatar', { schema: { response: UserAnswers } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user || !withinUploadLimit(reply, user.id)) return reply;
    const result = await avatars.setUserAvatar(user, await readAvatarUpload(request), request.log);
    if (result.status === 'not_found')
      return reply.code(404).send(failure('Аккаунт не найден', { code: 'account_not_found' }));
    return { ok: true as const, user: result.user };
  });

  app.delete('/api/auth/avatar', { schema: { response: UserAnswers } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const result = await avatars.clearUserAvatar(user.id, request.log);
    if (result.status === 'not_found')
      return reply.code(404).send(failure('Аккаунт не найден', { code: 'account_not_found' }));
    return { ok: true as const, user: result.user };
  });

  app.post(
    '/api/rooms/:roomId/avatar',
    { schema: { params: RoomIdParams, response: RoomAnswers } },
    async (request, reply) => {
      const room = await ownedRoom(request.params.roomId, request, reply);
      if (!room || !withinUploadLimit(reply, room.ownerId as string)) return reply;
      const result = await avatars.setRoomAvatar(room, await readAvatarUpload(request), request.log);
      if (result.status === 'not_found')
        return reply.code(404).send(failure('Комната не найдена', { code: 'room_not_found' }));
      return { ok: true as const, room: result.room };
    }
  );

  app.delete(
    '/api/rooms/:roomId/avatar',
    { schema: { params: RoomIdParams, response: RoomAnswers } },
    async (request, reply) => {
      const room = await ownedRoom(request.params.roomId, request, reply);
      if (!room) return reply;
      const result = await avatars.clearRoomAvatar(room.id, request.log);
      if (result.status === 'not_found')
        return reply.code(404).send(failure('Комната не найдена', { code: 'room_not_found' }));
      return { ok: true as const, room: result.room };
    }
  );

  // Content-addressed files never change, so browsers may keep them forever.
  async function sendImage(reply: FastifyReply, open: Promise<unknown>, missing: string) {
    const stream = await open;
    if (!stream) return reply.code(404).send(failure(missing, { code: 'image_not_found' }));
    return reply.header('Cache-Control', 'public, max-age=31536000, immutable').type('image/webp').send(stream);
  }

  app.get('/api/avatars/:key', { schema: { params: ImageKeyParams } }, async (request, reply) =>
    sendImage(reply, avatars.openAvatar(request.params.key), 'Avatar not found')
  );

  app.get('/api/link-previews/:key', { schema: { params: ImageKeyParams } }, async (request, reply) =>
    sendImage(reply, avatars.openLinkPreviewImage(request.params.key), 'Image not found')
  );
}
