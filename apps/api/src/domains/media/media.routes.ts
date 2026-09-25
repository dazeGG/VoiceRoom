/// <reference types="@fastify/multipart" />
// Image attachments over HTTP: reserve a slot, upload its bytes (multipart or
// a raw body), poll its processing, retry or delete it, and read a variant of
// a visible attachment. Every refusal carries the media service's code.

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Failure, IdParams } from '@voice-room/shared/contracts/http';
import {
  AttachmentAnswer,
  AttachmentVariantParams,
  AttachmentVariantQuery,
  CreateAttachmentBody
} from '@voice-room/shared/contracts/media';
import type { ApiContext } from '../../app/context.ts';
import { failure, optionalJsonBody, sendServiceError } from '../../platform/http/http-kit.ts';
import type { MediaService, PublicAttachment } from './media-service.ts';
import type { OpenedMedia } from './media-visibility-service.ts';

const ATTACHMENT_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface MediaRoutesDeps {
  media: MediaService;
  /** Opens a variant the viewer may see; without it the variant route is not served. */
  visibility?: {
    open(input: { attachmentId: string; variant: unknown; viewerId: string }): Promise<OpenedMedia>;
  } | null;
  uploadsEnabled(): boolean;
  readsEnabled(): boolean;
}

function cleanAttachmentId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  return ATTACHMENT_ID_PATTERN.test(id) ? id : '';
}

const answers = { 200: AttachmentAnswer, '4xx': Failure, '5xx': Failure };
const UPLOADS_DISABLED = failure('Media uploads are unavailable', { code: 'media_uploads_disabled' });

async function noStore(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  reply.header('Cache-Control', 'no-store');
}

export function registerMediaRoutes(root: FastifyInstance, ctx: ApiContext, deps: MediaRoutesDeps): void {
  const app = root.withTypeProvider<TypeBoxTypeProvider>();
  const { media } = deps;

  async function signedIn(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const userId = (await ctx.resolveSession(request.raw))?.user?.id;
    if (userId) return userId;
    reply.code(401).send(failure('Authentication required', { code: 'authentication_required' }));
    return null;
  }

  function attachmentId(raw: string, reply: FastifyReply): string {
    const id = cleanAttachmentId(raw);
    if (!id) reply.code(400).send(failure('Invalid attachment id', { code: 'media_attachment_id_invalid' }));
    return id;
  }

  /** Runs one owner operation on an attachment and answers it. */
  async function answer(
    request: FastifyRequest,
    reply: FastifyReply,
    operation: () => Promise<PublicAttachment | null>,
    status: 200 | 201 = 200
  ) {
    try {
      const attachment = await operation();
      if (!attachment) return reply.code(404).send(failure('Attachment not found', { code: 'media_not_found' }));
      return reply.code(status).send({ ok: true as const, attachment });
    } catch (error) {
      return sendServiceError(reply, error, { fallback: 'media_error', log: request.log, what: 'Media request' });
    }
  }

  app.post(
    '/api/media/attachments',
    {
      onRequest: noStore,
      preValidation: optionalJsonBody,
      schema: { body: CreateAttachmentBody, response: { ...answers, 201: AttachmentAnswer } }
    },
    async (request, reply) => {
      const ownerId = await signedIn(request, reply);
      if (!ownerId) return reply;
      if (!deps.uploadsEnabled()) return reply.code(503).send(UPLOADS_DISABLED);
      const { context, clientRequestId, bytes } = request.body;
      return answer(request, reply, () => media.createSlot({ ownerId, context, clientRequestId, bytes }), 201);
    }
  );

  app.put(
    '/api/media/attachments/:id/content',
    { onRequest: noStore, schema: { params: IdParams, response: answers } },
    async (request, reply) => {
      const ownerId = await signedIn(request, reply);
      if (!ownerId) return reply;
      const id = attachmentId(request.params.id, reply);
      if (!id) return reply;
      if (!deps.uploadsEnabled()) return reply.code(503).send(UPLOADS_DISABLED);
      return answer(request, reply, async () => {
        let stream: AsyncIterable<unknown> | undefined = request.raw;
        let mimeType = String(request.headers['content-type'] || '').split(';')[0] ?? '';
        if (mimeType.startsWith('multipart/')) {
          const part = await request.file();
          stream = part?.file;
          mimeType = part?.mimetype || '';
        }
        return media.upload({ id, ownerId, stream, mimeType });
      });
    }
  );

  app.get(
    '/api/media/attachments/:id',
    { onRequest: noStore, schema: { params: IdParams, response: answers } },
    async (request, reply) => {
      const ownerId = await signedIn(request, reply);
      if (!ownerId) return reply;
      const id = attachmentId(request.params.id, reply);
      if (!id) return reply;
      return answer(request, reply, () => media.status({ id, ownerId }));
    }
  );

  app.post(
    '/api/media/attachments/:id/retry',
    { schema: { params: IdParams, response: answers } },
    async (request, reply) => {
      const ownerId = await signedIn(request, reply);
      if (!ownerId) return reply;
      const id = attachmentId(request.params.id, reply);
      if (!id) return reply;
      if (!deps.uploadsEnabled()) return reply.code(503).send(UPLOADS_DISABLED);
      return answer(request, reply, () => media.retry({ id, ownerId }));
    }
  );

  app.delete(
    '/api/media/attachments/:id',
    { schema: { params: IdParams, response: answers } },
    async (request, reply) => {
      const ownerId = await signedIn(request, reply);
      if (!ownerId) return reply;
      const id = attachmentId(request.params.id, reply);
      if (!id) return reply;
      return answer(request, reply, () => media.remove({ id, ownerId }));
    }
  );

  const { visibility } = deps;
  if (!visibility) return;
  // The image itself is binary, so the route has no response schema.
  app.get(
    '/api/media/attachments/:id/:variant',
    {
      schema: {
        params: AttachmentVariantParams,
        querystring: AttachmentVariantQuery
      }
    },
    async (request, reply) => {
      const viewerId = await signedIn(request, reply);
      if (!viewerId) return reply;
      const id = attachmentId(request.params.id, reply);
      if (!id) return reply;
      if (!deps.readsEnabled())
        return reply.code(404).send(failure('Attachment not found', { code: 'media_not_found' }));
      try {
        const opened = await visibility.open({ attachmentId: id, variant: request.params.variant, viewerId });
        const disposition = request.query.download === '1' ? 'attachment' : 'inline';
        return reply
          .header('Cache-Control', 'private, no-store')
          .header('Content-Disposition', `${disposition}; filename="image.${opened.extension}"`)
          .header('Content-Length', String(opened.bytes))
          .type(opened.mimeType)
          .send(opened.stream);
      } catch (error) {
        return sendServiceError(reply, error, { fallback: 'media_error', log: request.log, what: 'Media request' });
      }
    }
  );
}
