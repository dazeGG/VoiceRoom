import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { Failure } from '@voiceroom/shared/contracts/http';
import { LiveKitAdmission } from '@voiceroom/shared/contracts/admission';
import {
  CallActionBody,
  CallAnswer,
  CallBootstrap,
  CallDetails,
  CallIdParams,
  CallMissedPeerParams,
  CallMissedSeenAnswer,
  CallMissedSeenBody,
  CallNotificationTarget,
  CallStartBody,
  CallVoiceProof
} from '@voiceroom/shared/contracts/rings';
import { requireSession, type ApiContext } from '../../app/context.ts';
import { sendRateLimited } from '../../platform/http/http-kit.ts';
import type { CallRingService } from './call-rings.service.ts';

export function registerCallRingRoutes(root: FastifyInstance, ctx: ApiContext, calls: CallRingService): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  app.get(
    '/api/call-rings',
    { schema: { response: { 200: CallBootstrap, '4xx': Failure } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { user } = await requireSession(ctx, request);
      return calls.bootstrap(user.id);
    }
  );
  app.get(
    '/api/call-rings/notification/:callId',
    { schema: { params: CallIdParams, response: { 200: CallNotificationTarget, '4xx': Failure } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { user } = await requireSession(ctx, request);
      return calls.notificationTarget(user.id, request.params.callId);
    }
  );
  app.post(
    '/api/call-rings/missed/:peerUserId/seen',
    {
      schema: {
        params: CallMissedPeerParams,
        body: CallMissedSeenBody,
        response: { 200: CallMissedSeenAnswer, '4xx': Failure }
      }
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { user } = await requireSession(ctx, request);
      return calls.markMissedSeen(user.id, request.params.peerUserId, request.body);
    }
  );
  app.get(
    '/api/call-rings/:callId',
    { schema: { params: CallIdParams, response: { 200: CallDetails, '4xx': Failure } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { user } = await requireSession(ctx, request);
      return calls.details(user.id, request.params.callId);
    }
  );
  app.post(
    '/api/call-rings',
    { schema: { body: CallStartBody, response: { 200: CallAnswer, '4xx': Failure } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { user, session } = await requireSession(ctx, request);
      const { peerUserId, clientRequestId } = request.body;
      const result = await calls.start(
        { userId: user.id, sessionHash: session.tokenHash },
        peerUserId,
        clientRequestId
      );
      if ('retryAfterSeconds' in result)
        return sendRateLimited(reply, { code: 'call_rate_limited', message: 'Call rate limit reached', ...result });
      return result;
    }
  );
  app.post(
    '/api/call-rings/:callId/actions',
    { schema: { params: CallIdParams, body: CallActionBody, response: { 200: CallAnswer, '4xx': Failure } } },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { user, session } = await requireSession(ctx, request);
      const result = await calls.action(
        { userId: user.id, sessionHash: session.tokenHash },
        request.params.callId,
        request.body
      );
      if ('retryAfterSeconds' in result)
        return sendRateLimited(reply, { code: 'call_rate_limited', message: 'Call rate limit reached', ...result });
      return result;
    }
  );
  app.post(
    '/api/call-rings/:callId/livekit-token',
    {
      schema: {
        params: CallIdParams,
        body: CallVoiceProof,
        response: { 200: LiveKitAdmission, '4xx': Failure, 503: Failure }
      }
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { user, session } = await requireSession(ctx, request);
      return calls.token(user, session.tokenHash, request.params.callId, request.body.seatToken);
    }
  );
}
