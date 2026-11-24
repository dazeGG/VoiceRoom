import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { NativeVoiceAdmission, NativeVoiceAdmissionBody } from '@voiceroom/shared/contracts/admission';
import { RoomFailure } from '@voiceroom/shared/contracts/rooms';
import { requireSession, type ApiContext } from '../../app/context.ts';
import { failure } from '../../platform/http/http-kit.ts';
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

export function registerNativeVoiceRoutes(root: FastifyInstance, ctx: ApiContext, service: NativeVoiceService): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
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
}
