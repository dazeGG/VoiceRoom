// The Android app's push token over HTTP: POST registers it for the signed-in
// session, DELETE removes it. Both take { provider, token }.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { DeviceTokenBody } from '@voice-room/shared/contracts/devices';
import { Done, Failure } from '@voice-room/shared/contracts/http';
import { requireSession, type ApiContext } from '../../app/context.ts';
import { failure, sendRateLimited } from '../../platform/http/http-kit.ts';
import type { DeviceTokenService } from './device-token.service.ts';

const TOO_MANY = { code: 'push_rate_limited', message: 'Too many device token changes' } as const;

export function registerDeviceTokenRoutes(root: FastifyInstance, ctx: ApiContext, devices: DeviceTokenService): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  app.post(
    '/api/push/devices',
    { schema: { body: DeviceTokenBody, response: { 201: Done, '4xx': Failure, 503: Failure } } },
    async (request, reply) => {
      const { user, session } = await requireSession(ctx, request);
      const result = await devices.register({
        userId: user.id,
        sessionId: session.tokenHash,
        provider: request.body.provider,
        token: request.body.token,
        userAgent: String(request.headers['user-agent'] || '')
      });
      switch (result.status) {
        // Answered here, not thrown: the error handler turns every 5xx into internal_error.
        case 'disabled':
          return reply.code(503).send(failure('Push notifications are disabled', { code: 'push_disabled' }));
        case 'rate_limited':
          return sendRateLimited(reply, { ...TOO_MANY, retryAfterSeconds: result.retryAfterSeconds });
        case 'registered':
          return reply.code(201).send({ ok: true as const });
      }
    }
  );

  app.delete(
    '/api/push/devices',
    { schema: { body: DeviceTokenBody, response: { 200: Done, '4xx': Failure } } },
    async (request, reply) => {
      const { user } = await requireSession(ctx, request);
      const result = await devices.unregister({
        userId: user.id,
        provider: request.body.provider,
        token: request.body.token
      });
      if (result.status === 'rate_limited')
        return sendRateLimited(reply, { ...TOO_MANY, retryAfterSeconds: result.retryAfterSeconds });
      return { ok: true as const };
    }
  );
}
