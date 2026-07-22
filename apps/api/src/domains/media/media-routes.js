'use strict';

function sendError(reply, error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  return reply.code(status).send({
    ok: false,
    code: status >= 500 ? 'media_error' : error.code || 'media_error',
    error: status >= 500 ? 'Internal server error' : error.message
  });
}

function registerMediaRoutes({
  app,
  mediaService,
  mediaVisibilityService,
  readsEnabled = () => true,
  resolveUser,
  uploadsEnabled = () => true
} = {}) {
  if (!app || !mediaService || typeof resolveUser !== 'function') throw new TypeError('Media route dependencies are required');

  async function user(request, reply) {
    const session = await resolveUser(request);
    const resolved = session?.user || session;
    if (!resolved?.id) {
      reply.code(401).send({ ok: false, code: 'authentication_required', error: 'Authentication required' });
      return null;
    }
    return resolved;
  }

  app.post('/api/media/attachments', async (request, reply) => {
    const current = await user(request, reply); if (!current) return;
    if (!await uploadsEnabled(request)) return reply.code(503).send({ ok: false, code: 'media_uploads_disabled', error: 'Media uploads are unavailable' });
    try {
      const attachment = await mediaService.createSlot({ ownerId: current.id, ...request.body });
      return reply.header('Cache-Control', 'no-store').code(201).send({ ok: true, attachment });
    } catch (error) { return sendError(reply, error); }
  });

  app.put('/api/media/attachments/:id/content', async (request, reply) => {
    const current = await user(request, reply); if (!current) return;
    if (!await uploadsEnabled(request)) return reply.code(503).send({ ok: false, code: 'media_uploads_disabled', error: 'Media uploads are unavailable' });
    try {
      let stream = request.raw;
      let mimeType = String(request.headers?.['content-type'] || '').split(';')[0];
      if (typeof request.file === 'function' && mimeType.startsWith('multipart/')) {
        const part = await request.file();
        stream = part?.file;
        mimeType = part?.mimetype || '';
      }
      const attachment = await mediaService.upload({ id: request.params.id, ownerId: current.id, stream, mimeType });
      return reply.header('Cache-Control', 'no-store').send({ ok: true, attachment });
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/api/media/attachments/:id', async (request, reply) => {
    const current = await user(request, reply); if (!current) return;
    try {
      const attachment = await mediaService.status({ id: request.params.id, ownerId: current.id });
      return reply.header('Cache-Control', 'no-store').send({ ok: true, attachment });
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/api/media/attachments/:id/retry', async (request, reply) => {
    const current = await user(request, reply); if (!current) return;
    if (!await uploadsEnabled(request)) return reply.code(503).send({ ok: false, code: 'media_uploads_disabled', error: 'Media uploads are unavailable' });
    try { return reply.send({ ok: true, attachment: await mediaService.retry({ id: request.params.id, ownerId: current.id }) }); }
    catch (error) { return sendError(reply, error); }
  });

  app.delete('/api/media/attachments/:id', async (request, reply) => {
    const current = await user(request, reply); if (!current) return;
    try { return reply.send({ ok: true, attachment: await mediaService.remove({ id: request.params.id, ownerId: current.id }) }); }
    catch (error) { return sendError(reply, error); }
  });

  if (mediaVisibilityService?.open) {
    app.get('/api/media/attachments/:id/:variant', async (request, reply) => {
      const current = await user(request, reply); if (!current) return;
      if (!await readsEnabled(request)) return reply.code(404).send({ ok: false, code: 'media_not_found', error: 'Attachment not found' });
      try {
        const media = await mediaVisibilityService.open({ attachmentId: request.params.id, variant: request.params.variant, viewerId: current.id });
        return reply
          .header('Cache-Control', 'private, no-store')
          .header('Content-Disposition', `${request.query?.download === '1' ? 'attachment' : 'inline'}; filename="image.${media.extension}"`)
          .header('Content-Length', String(media.bytes))
          .type(media.mimeType)
          .send(media.stream);
      } catch (error) { return sendError(reply, error); }
    });
  }
}

module.exports = { registerMediaRoutes, sendError };
