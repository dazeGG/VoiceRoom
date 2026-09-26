// Message reactions over HTTP: a message's summaries, setting the viewer's
// reaction, and who reacted with an emoji.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { Failure } from '@voice-room/shared/contracts/http';
import {
  ReactionBody,
  ReactionParams,
  ReactionSet,
  ReactionSummaries,
  ReactorPage,
  ReactorsQuery
} from '@voice-room/shared/contracts/messages';
import type { ApiContext, SessionUser } from '../../app/context.ts';
import type { ReactionService } from './reaction.service.ts';

export interface ReactionRoutesDeps {
  reactions: Pick<ReactionService, 'getSummaries' | 'setDesired' | 'getReactors'>;
}

const answers = <Success>(success: Success) => ({ 200: success, '4xx': Failure, '5xx': Failure });

export function registerReactionRoutes(root: FastifyInstance, ctx: ApiContext, deps: ReactionRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  // A failure the services do not classify answers with the domain's own code.
  const config = { errorFallback: 'reaction_error' as const };
  const viewer = async (raw: Parameters<ApiContext['resolveSession']>[0]): Promise<SessionUser | null> =>
    (await ctx.resolveSession(raw))?.user ?? null;
  const conversation = (params: { type: string; conversationId: string }) => ({
    type: params.type,
    id: params.conversationId
  });

  app.get(
    '/api/reactions/:type/:conversationId/:messageId',
    { config, schema: { params: ReactionParams, response: answers(ReactionSummaries) } },
    async (request) => {
      const summaries = await deps.reactions.getSummaries({
        conversation: conversation(request.params),
        messageId: request.params.messageId,
        viewer: await viewer(request.raw)
      });
      return { ok: true as const, summaries };
    }
  );

  app.put(
    '/api/reactions/:type/:conversationId/:messageId',
    { config, schema: { params: ReactionParams, body: ReactionBody, response: answers(ReactionSet) } },
    async (request) => {
      const summary = await deps.reactions.setDesired({
        conversation: conversation(request.params),
        mutation: { messageId: request.params.messageId, emoji: request.body.emoji, active: request.body.active },
        viewer: await viewer(request.raw)
      });
      return { ok: true as const, summary };
    }
  );

  app.get(
    '/api/reactions/:type/:conversationId/:messageId/reactors',
    { config, schema: { params: ReactionParams, querystring: ReactorsQuery, response: answers(ReactorPage) } },
    async (request) => {
      const page = await deps.reactions.getReactors({
        conversation: conversation(request.params),
        messageId: request.params.messageId,
        emoji: request.query.emoji,
        query: request.query,
        viewer: await viewer(request.raw)
      });
      return { ok: true as const, ...page };
    }
  );
}
