// The support inbox over HTTP, for staff signed in to the admin app (its own
// session cookie, see domains/staff) whose role allows `support.reply`.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Failure } from '@voiceroom/shared/contracts/http';
import {
  SupportAttachmentParams,
  SupportNoted,
  SupportRead,
  SupportReplied,
  SupportResolved,
  SupportTextBody,
  SupportThread,
  SupportThreadList,
  SupportThreadsQuery,
  SupportUnread,
  SupportUserParams
} from '@voiceroom/shared/contracts/support';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody } from '../../platform/http/http-kit.ts';
import { requestIdempotencyKey } from '../messaging/message-input.ts';
import { openedMediaHeaders } from '../media/media-visibility.service.ts';
import type { SupportService } from './support.service.ts';

const SUPPORT_REQUIRED = failure('Support access required', { code: 'forbidden' });
const THREAD_NOT_FOUND = failure('Support conversation not found', { code: 'support_thread_not_found' });
const EMPTY = failure('The text is empty', { code: 'empty_message' });
const OFFICIAL_MISSING = failure('The official account is missing', { code: 'account_not_found' });
const THREAD_CHANGED = failure('The person wrote after staff last read the conversation', {
  code: 'support_thread_changed'
});

const answers = <Success>(success: Success) => ({ 200: success, '4xx': Failure, 503: Failure });

export interface SupportRoutesDeps {
  support: SupportService;
  /** The staff member behind the admin-app session, or null with the 401 sent. */
  staffUserId(request: FastifyRequest, reply: FastifyReply): Promise<string | null>;
}

export function registerSupportRoutes(root: FastifyInstance, _ctx: ApiContext, deps: SupportRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  const { support } = deps;

  app.get(
    '/api/admin/support/threads',
    { schema: { querystring: SupportThreadsQuery, response: answers(SupportThreadList) } },
    async (request, reply) => {
      const staffId = await deps.staffUserId(request, reply);
      if (!staffId) return reply;
      const result = await support.list(staffId, request.query.status ?? 'open');
      if (result.status === 'forbidden') return reply.code(403).send(SUPPORT_REQUIRED);
      const { status: _status, ...listed } = result;
      return { ok: true as const, ...listed };
    }
  );

  app.get('/api/admin/support/unread', { schema: { response: answers(SupportUnread) } }, async (request, reply) => {
    const staffId = await deps.staffUserId(request, reply);
    if (!staffId) return reply;
    const result = await support.unread(staffId);
    if (result.status === 'forbidden') return reply.code(403).send(SUPPORT_REQUIRED);
    return { ok: true as const, openUnread: result.openUnread };
  });

  app.get(
    '/api/admin/support/threads/:userId',
    { schema: { params: SupportUserParams, response: answers(SupportThread) } },
    async (request, reply) => {
      const staffId = await deps.staffUserId(request, reply);
      if (!staffId) return reply;
      const result = await support.read(staffId, request.params.userId);
      if (result.status === 'forbidden') return reply.code(403).send(SUPPORT_REQUIRED);
      if (result.status === 'not_found') return reply.code(404).send(THREAD_NOT_FOUND);
      const { status: _status, threadStatus, ...thread } = result;
      return { ok: true as const, status: threadStatus, ...thread };
    }
  );

  app.post(
    '/api/admin/support/threads/:userId/read',
    { preValidation: optionalJsonBody, schema: { params: SupportUserParams, response: answers(SupportRead) } },
    async (request, reply) => {
      const staffId = await deps.staffUserId(request, reply);
      if (!staffId) return reply;
      const result = await support.markRead(staffId, request.params.userId);
      if (result.status === 'forbidden') return reply.code(403).send(SUPPORT_REQUIRED);
      if (result.status === 'not_found') return reply.code(404).send(THREAD_NOT_FOUND);
      return { ok: true as const, openUnread: result.openUnread };
    }
  );

  // An optional Idempotency-Key header makes a retried answer send once.
  app.post(
    '/api/admin/support/threads/:userId/reply',
    {
      preValidation: optionalJsonBody,
      schema: { params: SupportUserParams, body: SupportTextBody, response: answers(SupportReplied) }
    },
    async (request, reply) => {
      const staffId = await deps.staffUserId(request, reply);
      if (!staffId) return reply;
      const result = await support.reply(
        staffId,
        request.params.userId,
        request.body.text,
        requestIdempotencyKey(request.raw, null)
      );
      switch (result.status) {
        case 'forbidden':
          return reply.code(403).send(SUPPORT_REQUIRED);
        case 'not_found':
          return reply.code(404).send(THREAD_NOT_FOUND);
        case 'empty':
          return reply.code(400).send(EMPTY);
        case 'official_missing':
          return reply.code(503).send(OFFICIAL_MISSING);
        case 'rate_limited':
          return reply
            .code(429)
            .header('Retry-After', String(result.retryAfterSeconds))
            .send({
              ...failure('Too many answers, try again later', { code: 'message_rate_limited' }),
              retryAfterSeconds: result.retryAfterSeconds
            });
        case 'sent':
          return { ok: true as const, message: result.message };
      }
    }
  );

  app.post(
    '/api/admin/support/threads/:userId/notes',
    {
      preValidation: optionalJsonBody,
      schema: { params: SupportUserParams, body: SupportTextBody, response: answers(SupportNoted) }
    },
    async (request, reply) => {
      const staffId = await deps.staffUserId(request, reply);
      if (!staffId) return reply;
      const result = await support.note(staffId, request.params.userId, request.body.text);
      if (result.status === 'forbidden') return reply.code(403).send(SUPPORT_REQUIRED);
      if (result.status === 'not_found') return reply.code(404).send(THREAD_NOT_FOUND);
      if (result.status === 'empty') return reply.code(400).send(EMPTY);
      return { ok: true as const, note: result.note };
    }
  );

  app.post(
    '/api/admin/support/threads/:userId/resolve',
    { preValidation: optionalJsonBody, schema: { params: SupportUserParams, response: answers(SupportResolved) } },
    async (request, reply) => {
      const staffId = await deps.staffUserId(request, reply);
      if (!staffId) return reply;
      const result = await support.resolve(staffId, request.params.userId);
      if (result.status === 'forbidden') return reply.code(403).send(SUPPORT_REQUIRED);
      if (result.status === 'not_found') return reply.code(404).send(THREAD_NOT_FOUND);
      if (result.status === 'changed') return reply.code(409).send(THREAD_CHANGED);
      return { ok: true as const, status: 'resolved' as const, resolvedAt: result.resolvedAt };
    }
  );

  // The image or the diagnostics file is binary, so the route has no response schema.
  app.get(
    '/api/admin/support/attachments/:id/:variant',
    { schema: { params: SupportAttachmentParams } },
    async (request, reply) => {
      const staffId = await deps.staffUserId(request, reply);
      if (!staffId) return reply;
      const result = await support.attachment(staffId, request.params.id, request.params.variant);
      if (result.status === 'forbidden') return reply.code(403).send(SUPPORT_REQUIRED);
      const { opened } = result;
      return reply
        .header('Cache-Control', 'private, no-store')
        .headers(openedMediaHeaders(opened, false))
        .send(opened.stream);
    }
  );
}
