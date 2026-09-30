// POST /api/livekit-token: turns an admission result into the HTTP answer.
// The client's recovery logic keys on the refusal codes.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { LiveKitAdmission, LiveKitTokenBody } from '@voice-room/shared/contracts/admission';
import { RoomFailure } from '@voice-room/shared/contracts/rooms';
import {
  cleanName,
  isReservedPeerId,
  normalizePeerId,
  normalizeRoomId,
  normalizeSessionToken
} from '@voice-room/shared/validation';
import type { ApiContext } from '../../app/context.ts';
import { failure, type Failure } from '../../platform/http/http-kit.ts';
import type { AdmissionService, RefusalReason } from './admission.service.ts';

const ROOM_BANNED_ERROR = 'Вы заблокированы в этой комнате';

const REFUSALS: Record<RefusalReason, { status: 400 | 403 | 404 | 409 | 503; body: Failure }> = {
  invalid_request: { status: 400, body: failure('Invalid room, peer, or session token', { code: 'invalid_request' }) },
  room_not_found: { status: 404, body: failure('Комната не найдена', { code: 'room_not_found' }) },
  room_banned: { status: 403, body: failure(ROOM_BANNED_ERROR, { code: 'room_banned' }) },
  not_in_room: { status: 409, body: failure('Сначала нужно войти в комнату', { code: 'not_in_room' }) },
  invalid_session: { status: 403, body: failure('Сессия участника недействительна', { code: 'invalid_session' }) },
  livekit_unconfigured: {
    status: 503,
    body: failure('LiveKit не настроен: проверьте LIVEKIT_URL, LIVEKIT_API_KEY и LIVEKIT_API_SECRET', {
      code: 'livekit_unconfigured'
    })
  },
  livekit_gate_unconfigured: {
    status: 503,
    body: failure('LiveKit gate is not configured', { code: 'livekit_gate_unavailable' })
  },
  livekit_gate_principal_unavailable: {
    status: 503,
    body: failure('LiveKit gate principal unavailable', { code: 'livekit_gate_principal_unavailable' })
  },
  server_mute_unavailable: {
    status: 503,
    body: failure('Voice moderation state is unavailable', { code: 'server_mute_unavailable' })
  },
  membership_unavailable: {
    status: 503,
    body: failure('Membership service unavailable', { code: 'membership_unavailable' })
  },
  livekit_gate_unavailable: {
    status: 503,
    body: failure('LiveKit gate unavailable', { code: 'livekit_gate_unavailable' })
  },
  livekit_gate_credential_unavailable: {
    status: 503,
    body: failure('LiveKit gate unavailable', { code: 'livekit_gate_credential_unavailable' })
  },
  membership_persist_failed: {
    status: 503,
    body: failure('Membership unavailable', { code: 'membership_persist_failed' })
  }
};

export function registerAdmissionRoutes(root: FastifyInstance, ctx: ApiContext, admission: AdmissionService): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();

  app.post(
    '/api/livekit-token',
    {
      schema: {
        body: LiveKitTokenBody,
        response: { 200: LiveKitAdmission, '4xx': RoomFailure, 503: RoomFailure }
      }
    },
    async (request, reply) => {
      const roomId: string = normalizeRoomId(request.body.roomId);
      const peerId: string = normalizePeerId(request.body.peerId);
      const sessionToken: string = normalizeSessionToken(request.body.sessionToken);

      const refuse = (reason: RefusalReason) => {
        const refusal = REFUSALS[reason];
        const body = reason === 'room_banned' ? { ...refusal.body, roomId } : refusal.body;
        return reply.code(refusal.status).send(body);
      };

      // `auth-<userId>` is the API's own account peer id and never a voice peer.
      if (!roomId || !peerId || !sessionToken || isReservedPeerId(peerId)) return refuse('invalid_request');

      const session = await ctx.resolveSession(request.raw);
      const result = await admission.admit({
        roomId,
        peerId,
        sessionToken,
        name: cleanName(request.body.name),
        user: session?.user ?? null,
        clientIp: ctx.clientIp(request.raw),
        log: request.log
      });
      if (result.status === 'refused') return refuse(result.reason);
      return { ok: true as const, ...result.admission };
    }
  );
}
