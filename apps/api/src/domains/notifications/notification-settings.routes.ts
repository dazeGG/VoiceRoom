// Notification settings, presence status and push subscriptions over HTTP.

import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { cleanPresenceStatus, normalizeRoomId } from '@voice-room/shared/validation';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody } from '../../platform/http/http-kit.ts';
import { cleanUuid } from '../messaging/message-input.ts';
import type { MutationResult, NotificationSettingsService } from './notification-settings.service.ts';

const Answer = Type.Object({ ok: Type.Literal(true), muted: Type.Optional(Type.Boolean()), preferences: Type.Optional(Type.Unknown()) });
const Refusal = Type.Object({ ok: Type.Literal(false), error: Type.String(), retryAfterSeconds: Type.Optional(Type.Number()) });
const Responses = { 200: Answer, 201: Answer, '4xx': Refusal, 503: Refusal };
const Field = Type.Optional(Type.Unknown());
const INVALID_TARGET = failure('Invalid notification target');

const MUTATION_REFUSALS: Record<string, { status: 400 | 403 | 404; error: string }> = {
  not_found: { status: 404, error: 'Not found' },
  self: { status: 400, error: 'Invalid notification target' },
  temporary_room: { status: 403, error: 'Only saved rooms can be muted' },
  not_saved_room: { status: 403, error: 'Room is not saved' }
};

function mutationAnswer(reply: FastifyReply, result: MutationResult, muted: boolean | null = null) {
  const refusal = MUTATION_REFUSALS[result.status];
  if (refusal) return reply.code(refusal.status).send(failure(refusal.error));
  return { ok: true as const, ...(muted === null ? {} : { muted }), preferences: result.preferences };
}

/** `{ ok, value }` when the field is a boolean, `{ ok: false, error }` otherwise. */
function requiredBoolean(body: Record<string, unknown>, field: string): { ok: true; value: boolean } | { ok: false; error: string } {
  const value = body[field];
  return typeof value === 'boolean' ? { ok: true, value } : { ok: false, error: `${field} must be a boolean` };
}

function tooMany(reply: FastifyReply, retryAfterSeconds: number) {
  return reply.code(429).header('Retry-After', String(retryAfterSeconds))
    .send({ ...failure('Too many push subscription changes'), retryAfterSeconds });
}

export function registerNotificationSettingsRoutes(root: FastifyInstance, ctx: ApiContext, settings: NotificationSettingsService): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  async function signedIn(request: FastifyRequest, reply: FastifyReply) {
    const user = (await ctx.resolveSession(request.raw))?.user;
    if (user) return user;
    reply.code(401).send(failure('Требуется вход'));
    return null;
  }

  app.get('/api/notifications/preferences', { schema: { response: Responses } }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    return { ok: true as const, preferences: await settings.preferences(user.id) };
  });

  app.put('/api/notifications/dm/:userId/mute', {
    preValidation: optionalJsonBody,
    schema: { params: Type.Object({ userId: Type.String() }), body: Type.Object({ muted: Field }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const peerId = cleanUuid(request.params.userId);
    if (!peerId || peerId === user.id) return reply.code(peerId === user.id ? 400 : 404).send(INVALID_TARGET);
    const muted = requiredBoolean(request.body, 'muted');
    if (!muted.ok) return reply.code(400).send(failure(muted.error));
    return mutationAnswer(reply, await settings.setDmMute(user.id, peerId, muted.value), muted.value);
  });

  app.put('/api/notifications/room/:roomId/mute', {
    preValidation: optionalJsonBody,
    schema: { params: Type.Object({ roomId: Type.String() }), body: Type.Object({ muted: Field }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const roomId: string = normalizeRoomId(request.params.roomId);
    if (!roomId) return reply.code(404).send(INVALID_TARGET);
    const muted = requiredBoolean(request.body, 'muted');
    if (!muted.ok) return reply.code(400).send(failure(muted.error));
    return mutationAnswer(reply, await settings.setRoomMute(user.id, roomId, muted.value), muted.value);
  });

  app.put('/api/notifications/privacy', {
    preValidation: optionalJsonBody,
    schema: { body: Type.Object({ privateNotifications: Field }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const value = requiredBoolean(request.body, 'privateNotifications');
    if (!value.ok) return reply.code(400).send(failure(value.error));
    return mutationAnswer(reply, await settings.setPrivateNotifications(user.id, value.value));
  });

  app.post('/api/notifications/settings', {
    preValidation: optionalJsonBody,
    schema: { body: Type.Object({ dnd: Field }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const dnd = requiredBoolean(request.body, 'dnd');
    if (!dnd.ok) return reply.code(400).send(failure(dnd.error));
    return mutationAnswer(reply, await settings.setDoNotDisturb(user, dnd.value, request.log));
  });

  app.post('/api/presence/status', {
    preValidation: optionalJsonBody,
    schema: { body: Type.Object({ status: Field, automatic: Field }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const { body } = request;
    const presenceStatus: string = cleanPresenceStatus(body.status);
    if (!presenceStatus) return reply.code(400).send(failure('status must be one of: online, away, dnd, offline'));
    if (body.automatic !== undefined && typeof body.automatic !== 'boolean') return reply.code(400).send(failure('automatic must be a boolean'));
    const automatic = body.automatic === true;
    // Idle detection may only move between online and away; it never
    // overrides a status the person chose.
    if (automatic && presenceStatus !== 'away' && presenceStatus !== 'online') {
      return reply.code(400).send(failure('automatic presence can only transition between online and away'));
    }
    return mutationAnswer(reply, await settings.setPresenceStatus(user, presenceStatus, automatic, request.log));
  });

  // The public VAPID key and whether push is on; no envelope, as before.
  app.get('/api/push/config', async () => settings.pushConfig());

  app.post('/api/push/subscriptions', {
    preValidation: optionalJsonBody,
    schema: { body: Type.Object({ subscription: Field }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const result = await settings.subscribe(user.id, request.body.subscription, String(request.headers['user-agent'] || ''));
    switch (result.status) {
      case 'disabled': return reply.code(503).send(failure('Push notifications are disabled'));
      case 'invalid': return reply.code(400).send(failure('Invalid push subscription'));
      case 'rate_limited': return tooMany(reply, result.retryAfterSeconds);
      case 'conflict': return reply.code(409).send(failure('Push endpoint belongs to another subscription'));
      case 'subscribed': return reply.code(201).send({ ok: true as const });
    }
  });

  app.delete('/api/push/subscriptions', {
    preValidation: optionalJsonBody,
    schema: { body: Type.Object({ endpoint: Field }), response: Responses }
  }, async (request, reply) => {
    const user = await signedIn(request, reply);
    if (!user) return reply;
    const result = await settings.unsubscribe(user.id, request.body.endpoint);
    if (result.status === 'invalid') return reply.code(400).send(failure('Invalid push endpoint'));
    if (result.status === 'rate_limited') return tooMany(reply, result.retryAfterSeconds);
    return { ok: true as const };
  });
}
