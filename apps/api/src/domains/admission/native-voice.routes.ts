import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import {
  NativeVoiceAdmission,
  NativeVoiceAdmissionBody,
  NativeVoiceRenewal,
  NativeVoiceRenewalBody
} from '@voiceroom/shared/contracts/admission';
import { RoomFailure } from '@voiceroom/shared/contracts/rooms';
import { requireSession, type ApiContext } from '../../app/context.ts';
import { createRateLimiter } from '../../lib/rate-limit.ts';
import { failure, sendRateLimited } from '../../platform/http/http-kit.ts';
import type { NativeVoiceService } from './native-voice.service.ts';

const REFUSALS = {
  off: { status: 403, code: 'native_voice_off' },
  ineligible: { status: 403, code: 'native_voice_ineligible' },
  wrong_room: { status: 404, code: 'room_not_found' },
  stale: { status: 409, code: 'native_voice_stale' },
  banned: { status: 403, code: 'room_banned' },
  capacity: { status: 409, code: 'native_voice_capacity' },
  unavailable: { status: 503, code: 'livekit_gate_unavailable' }
} as const;

const RATE_LIMITED = { code: 'rate_limited', message: 'Too many native voice requests' } as const;

function requestBudget(sessionLimit: number, accountLimit: number) {
  const windowMs = 60_000;
  const sessions = createRateLimiter({ limit: sessionLimit, windowMs });
  const accounts = createRateLimiter({ limit: accountLimit, windowMs });
  return (accountId: string, sessionHash: string) => {
    const session = sessions.check(sessionHash);
    return session.allowed ? accounts.check(accountId) : session;
  };
}

export function registerNativeVoiceRoutes(root: FastifyInstance, ctx: ApiContext, service: NativeVoiceService): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  const admissionBudget = requestBudget(10, 20);
  const renewalBudget = requestBudget(10, 24);
  app.post(
    '/api/native-voice/admission',
    {
      schema: {
        body: NativeVoiceAdmissionBody,
        response: { 200: NativeVoiceAdmission, '4xx': RoomFailure, 503: RoomFailure }
      }
    },
    async (request, reply) => {
      const { user, session } = await requireSession(ctx, request);
      const decision = admissionBudget(user.id, session.tokenHash);
      if (!decision.allowed) return sendRateLimited(reply, { ...RATE_LIMITED, ...decision });
      const result = await service.admit(request.body, {
        accountId: user.id,
        authSessionHash: session.tokenHash,
        ip: ctx.clientIp(request.raw)
      });
      if (result.status === 'issued') return result.admission;
      const { status, code } = REFUSALS[result.status];
      return reply.code(status).send(failure('Native voice admission refused', { code }));
    }
  );
  app.post(
    '/api/native-voice/renewal',
    {
      schema: {
        body: NativeVoiceRenewalBody,
        response: { 200: NativeVoiceRenewal, '4xx': RoomFailure, 503: RoomFailure }
      }
    },
    async (request, reply) => {
      const { user, session } = await requireSession(ctx, request);
      const decision = renewalBudget(user.id, session.tokenHash);
      if (!decision.allowed) return sendRateLimited(reply, { ...RATE_LIMITED, ...decision });
      const result = await service.renew(request.body, {
        accountId: user.id,
        authSessionHash: session.tokenHash,
        ip: ctx.clientIp(request.raw)
      });
      if (result.status === 'issued') return result.admission;
      const { status, code } = REFUSALS[result.status];
      return reply.code(status).send(failure('Native voice renewal refused', { code }));
    }
  );
}
