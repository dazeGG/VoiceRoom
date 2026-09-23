import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MediaService } from './media-service.ts';
import type { OpenedMedia } from './media-visibility-service.ts';

const ATTACHMENT_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

type RouteError = { statusCode?: unknown; code?: string; message?: string } | null | undefined;
type MediaRoute = {
  Params: { id?: string; variant?: string };
  Querystring: { download?: string };
  Body: Record<string, unknown> | null;
};
type MediaRequest = FastifyRequest<MediaRoute> & {
  file?: () => Promise<{ file?: AsyncIterable<unknown>; mimetype?: string } | undefined>;
};
type Viewer = { id: string; [key: string]: unknown };
type Gate = (request: FastifyRequest) => unknown;

function cleanAttachmentId(value: unknown): string {
  const id = String(value || '').trim();
  return ATTACHMENT_ID_PATTERN.test(id) ? id : '';
}

function sendError(reply: FastifyReply, error: unknown) {
  const failure = error as RouteError;
  const status = Number.isInteger(failure?.statusCode) ? failure?.statusCode as number : 500;
  return reply.code(status).send({
    ok: false,
    code: status >= 500 ? 'media_error' : failure?.code || 'media_error',
    error: status >= 500 ? 'Internal server error' : failure?.message
  });
}

function registerMediaRoutes({
  app,
  mediaService,
  mediaVisibilityService,
  readsEnabled = () => true,
  resolveUser,
  uploadsEnabled = () => true
}: {
  app?: FastifyInstance;
  mediaService?: MediaService;
  mediaVisibilityService?: { open?: (input: { attachmentId: string; variant: unknown; viewerId: string }) => Promise<OpenedMedia> } | null;
  readsEnabled?: Gate;
  resolveUser?: (request: FastifyRequest) => unknown;
  uploadsEnabled?: Gate;
} = {}): void {
  if (!app || !mediaService || typeof resolveUser !== 'function') throw new TypeError('Media route dependencies are required');
  const media = mediaService;
  const resolve = resolveUser;

  async function user(request: FastifyRequest, reply: FastifyReply): Promise<Viewer | null> {
    const session = await resolve(request) as { user?: Viewer } & Partial<Viewer> | null | undefined;
    const resolved = session?.user || session;
    if (!resolved?.id) {
      reply.code(401).send({ ok: false, code: 'authentication_required', error: 'Authentication required' });
      return null;
    }
    return resolved as Viewer;
  }

  function attachmentId(request: FastifyRequest<MediaRoute>, reply: FastifyReply): string {
    const id = cleanAttachmentId(request.params?.id);
    if (!id) {
      reply.code(400).send({ ok: false, code: 'media_attachment_id_invalid', error: 'Invalid attachment id' });
      return '';
    }
    return id;
  }

  app.post<MediaRoute>('/api/media/attachments', async (request, reply) => {
    const current = await user(request, reply); if (!current) return;
    if (!await uploadsEnabled(request)) return reply.code(503).send({ ok: false, code: 'media_uploads_disabled', error: 'Media uploads are unavailable' });
    try {
      const attachment = await media.createSlot({ ownerId: current.id, ...request.body });
      return reply.header('Cache-Control', 'no-store').code(201).send({ ok: true, attachment });
    } catch (error) { return sendError(reply, error); }
  });

  app.put<MediaRoute>('/api/media/attachments/:id/content', async (request, reply) => {
    const current = await user(request, reply); if (!current) return;
    const id = attachmentId(request, reply); if (!id) return;
    if (!await uploadsEnabled(request)) return reply.code(503).send({ ok: false, code: 'media_uploads_disabled', error: 'Media uploads are unavailable' });
    try {
      const multipart = request as MediaRequest;
      let stream: AsyncIterable<unknown> | undefined = request.raw;
      let mimeType = String(request.headers?.['content-type'] || '').split(';')[0] as string;
      if (typeof multipart.file === 'function' && mimeType.startsWith('multipart/')) {
        const part = await multipart.file();
        stream = part?.file;
        mimeType = part?.mimetype || '';
      }
      const attachment = await media.upload({ id, ownerId: current.id, stream, mimeType });
      return reply.header('Cache-Control', 'no-store').send({ ok: true, attachment });
    } catch (error) { return sendError(reply, error); }
  });

  app.get<MediaRoute>('/api/media/attachments/:id', async (request, reply) => {
    const current = await user(request, reply); if (!current) return;
    const id = attachmentId(request, reply); if (!id) return;
    try {
      const attachment = await media.status({ id, ownerId: current.id });
      return reply.header('Cache-Control', 'no-store').send({ ok: true, attachment });
    } catch (error) { return sendError(reply, error); }
  });

  app.post<MediaRoute>('/api/media/attachments/:id/retry', async (request, reply) => {
    const current = await user(request, reply); if (!current) return;
    const id = attachmentId(request, reply); if (!id) return;
    if (!await uploadsEnabled(request)) return reply.code(503).send({ ok: false, code: 'media_uploads_disabled', error: 'Media uploads are unavailable' });
    try { return reply.send({ ok: true, attachment: await media.retry({ id, ownerId: current.id }) }); }
    catch (error) { return sendError(reply, error); }
  });

  app.delete<MediaRoute>('/api/media/attachments/:id', async (request, reply) => {
    const current = await user(request, reply); if (!current) return;
    const id = attachmentId(request, reply); if (!id) return;
    try { return reply.send({ ok: true, attachment: await media.remove({ id, ownerId: current.id }) }); }
    catch (error) { return sendError(reply, error); }
  });

  if (mediaVisibilityService?.open) {
    const visibility = mediaVisibilityService as { open: NonNullable<typeof mediaVisibilityService.open> };
    app.get<MediaRoute>('/api/media/attachments/:id/:variant', async (request, reply) => {
      const current = await user(request, reply); if (!current) return;
      const id = attachmentId(request, reply); if (!id) return;
      if (!await readsEnabled(request)) return reply.code(404).send({ ok: false, code: 'media_not_found', error: 'Attachment not found' });
      try {
        const opened = await visibility.open({ attachmentId: id, variant: request.params.variant, viewerId: current.id });
        return reply
          .header('Cache-Control', 'private, no-store')
          .header('Content-Disposition', `${request.query?.download === '1' ? 'attachment' : 'inline'}; filename="image.${opened.extension}"`)
          .header('Content-Length', String(opened.bytes))
          .type(opened.mimeType)
          .send(opened.stream);
      } catch (error) { return sendError(reply, error); }
    });
  }
}

export { cleanAttachmentId, registerMediaRoutes, sendError };
