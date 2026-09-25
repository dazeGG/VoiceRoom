// Notification settings, presence status and push subscriptions over HTTP.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorCode } from '@voice-room/shared/contracts/errors';
import { Done, Failure, RoomIdParams, UserIdParams } from '@voice-room/shared/contracts/http';
import {
  DoNotDisturbBody,
  MuteBody,
  Muted,
  Preferences,
  PresenceBody,
  PrivacyBody,
  PushConfig,
  SubscribeBody,
  UnsubscribeBody
} from '@voice-room/shared/contracts/notifications';
import { cleanPresenceStatus, normalizeRoomId } from '@voice-room/shared/validation';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody } from '../../platform/http/http-kit.ts';
import { cleanUuid } from '../messaging/message-input.ts';
import type { MutationResult, NotificationSettingsService } from './notification-settings.service.ts';

const answers = <Success>(success: Success) => ({ 200: success, '4xx': Failure, 503: Failure });
const INVALID_TARGET = failure('Invalid notification target', { code: 'invalid_notification_target' });

const MUTATION_REFUSALS: Record<string, { status: 400 | 403 | 404; error: string; code: ErrorCode }> = {
  not_found: { status: 404, error: 'Not found', code: 'not_found' },
  self: { status: 400, error: 'Invalid notification target', code: 'invalid_notification_target' },
  temporary_room: { status: 403, error: 'Only saved rooms can be muted', code: 'temporary_room' },
  not_saved_room: { status: 403, error: 'Room is not saved', code: 'not_saved_room' }
};

function refused(reply: FastifyReply, result: MutationResult) {
  const refusal = MUTATION_REFUSALS[result.status];
  return refusal ? reply.code(refusal.status).send(failure(refusal.error, { code: refusal.code })) : null;
}

const invalid = (error: string) => failure(error, { code: 'invalid_request' });
// The schema refuses a field of the wrong type with the same text.
const missing = (field: string) => invalid(`${field} must be a boolean`);

function tooMany(reply: FastifyReply, retryAfterSeconds: number) {
  return reply
    .code(429)
    .header('Retry-After', String(retryAfterSeconds))
    .send({ ...failure('Too many push subscription changes', { code: 'push_rate_limited' }), retryAfterSeconds });
}

export function registerNotificationSettingsRoutes(
  root: FastifyInstance,
  ctx: ApiContext,
  settings: NotificationSettingsService
): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  async function signedIn(request: FastifyRequest, reply: FastifyReply) {
    const user = (await ctx.resolveSession(request.raw))?.user;
    if (user) return user;
    reply.code(401).send(failure('Требуется вход', { code: 'authentication_required' }));
    return null;
  }

  app.get('/api/notifications/preferences', { schema: { response: answers(Preferences) } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    return { ok: true as const, preferences: await settings.preferences(user.id) };
  });

  app.put(
    '/api/notifications/dm/:userId/mute',
    {
      preValidation: optionalJsonBody,
      schema: {
        params: UserIdParams,
        body: MuteBody,
        response: answers(Muted)
      }
    },
    async (request, reply) => {
      const user = await signedIn(request, reply);
      if (!user) return reply;
      const peerId = cleanUuid(request.params.userId);
      if (!peerId || peerId === user.id) return reply.code(peerId === user.id ? 400 : 404).send(INVALID_TARGET);
      const { muted } = request.body;
      if (muted === undefined) return reply.code(400).send(missing('muted'));
      const result = await settings.setDmMute(user.id, peerId, muted);
      return refused(reply, result) ?? { ok: true as const, muted, preferences: result.preferences };
    }
  );

  app.put(
    '/api/notifications/room/:roomId/mute',
    {
      preValidation: optionalJsonBody,
      schema: {
        params: RoomIdParams,
        body: MuteBody,
        response: answers(Muted)
      }
    },
    async (request, reply) => {
      const user = await signedIn(request, reply);
      if (!user) return reply;
      const roomId: string = normalizeRoomId(request.params.roomId);
      if (!roomId) return reply.code(404).send(INVALID_TARGET);
      const { muted } = request.body;
      if (muted === undefined) return reply.code(400).send(missing('muted'));
      const result = await settings.setRoomMute(user.id, roomId, muted);
      return refused(reply, result) ?? { ok: true as const, muted, preferences: result.preferences };
    }
  );

  app.put(
    '/api/notifications/privacy',
    {
      preValidation: optionalJsonBody,
      schema: { body: PrivacyBody, response: answers(Preferences) }
    },
    async (request, reply) => {
      const user = await signedIn(request, reply);
      if (!user) return reply;
      const { privateNotifications } = request.body;
      if (privateNotifications === undefined) return reply.code(400).send(missing('privateNotifications'));
      const result = await settings.setPrivateNotifications(user.id, privateNotifications);
      return refused(reply, result) ?? { ok: true as const, preferences: result.preferences };
    }
  );

  app.post(
    '/api/notifications/settings',
    {
      preValidation: optionalJsonBody,
      schema: { body: DoNotDisturbBody, response: answers(Preferences) }
    },
    async (request, reply) => {
      const user = await signedIn(request, reply);
      if (!user) return reply;
      const { dnd } = request.body;
      if (dnd === undefined) return reply.code(400).send(missing('dnd'));
      const result = await settings.setDoNotDisturb(user, dnd, request.log);
      return refused(reply, result) ?? { ok: true as const, preferences: result.preferences };
    }
  );

  app.post(
    '/api/presence/status',
    {
      preValidation: optionalJsonBody,
      schema: { body: PresenceBody, response: answers(Preferences) }
    },
    async (request, reply) => {
      const user = await signedIn(request, reply);
      if (!user) return reply;
      const { body } = request;
      const presenceStatus = cleanPresenceStatus(body.status);
      if (!presenceStatus) return reply.code(400).send(invalid('status must be one of: online, away, dnd, offline'));
      const automatic = body.automatic === true;
      // Idle detection may only move between online and away; it never
      // overrides a status the person chose.
      if (automatic && presenceStatus !== 'away' && presenceStatus !== 'online') {
        return reply.code(400).send(invalid('automatic presence can only transition between online and away'));
      }
      const result = await settings.setPresenceStatus(user, presenceStatus, automatic, request.log);
      return refused(reply, result) ?? { ok: true as const, preferences: result.preferences };
    }
  );

  app.get('/api/push/config', { schema: { response: { 200: PushConfig } } }, async () => settings.pushConfig());

  app.post(
    '/api/push/subscriptions',
    {
      preValidation: optionalJsonBody,
      schema: { body: SubscribeBody, response: { ...answers(Done), 201: Done } }
    },
    async (request, reply) => {
      const user = await signedIn(request, reply);
      if (!user) return reply;
      const result = await settings.subscribe(
        user.id,
        request.body.subscription,
        String(request.headers['user-agent'] || '')
      );
      switch (result.status) {
        case 'disabled':
          return reply.code(503).send(failure('Push notifications are disabled', { code: 'push_disabled' }));
        case 'invalid':
          return reply.code(400).send(failure('Invalid push subscription', { code: 'invalid_push_subscription' }));
        case 'rate_limited':
          return tooMany(reply, result.retryAfterSeconds);
        case 'conflict':
          return reply
            .code(409)
            .send(failure('Push endpoint belongs to another subscription', { code: 'push_endpoint_conflict' }));
        case 'subscribed':
          return reply.code(201).send({ ok: true as const });
      }
    }
  );

  app.delete(
    '/api/push/subscriptions',
    {
      preValidation: optionalJsonBody,
      schema: { body: UnsubscribeBody, response: answers(Done) }
    },
    async (request, reply) => {
      const user = await signedIn(request, reply);
      if (!user) return reply;
      const result = await settings.unsubscribe(user.id, request.body.endpoint);
      if (result.status === 'invalid')
        return reply.code(400).send(failure('Invalid push endpoint', { code: 'invalid_push_endpoint' }));
      if (result.status === 'rate_limited') return tooMany(reply, result.retryAfterSeconds);
      return { ok: true as const };
    }
  );
}
