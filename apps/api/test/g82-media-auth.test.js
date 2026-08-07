'use strict';
const assert = require('node:assert/strict');
const fastify = require('fastify');
const test = require('node:test');
const { registerMediaRoutes } = require('../src/domains/media/media-routes');
const { createMediaVisibilityService } = require('../src/domains/media/media-visibility-service');
const ID = '123e4567-e89b-42d3-a456-426614174000';
const MISSING = '223e4567-e89b-42d3-a456-426614174000';

function attachment(overrides = {}) { return { id: ID, ownerId: 'owner', context: 'room', internalState: 'ready', state: 'ready', deletedAt: null, boundAt: new Date(), roomMessageId: 'message', ...overrides }; }

test('G82-A01 draft owner, room guest/member and DM participants are authorized; ban/leave/expiry/delete/cross-context deny immediately', async () => {
  let row = attachment(); let allowed = true;
  const service = createMediaVisibilityService({
    attachmentRepository: { async findById(id) { return id === ID ? row : null; } },
    storage: { async openRead() { return { bytes: 4, stream: 'data' }; } },
    async authorizeRoomAttachment({ viewerId }) { return allowed && ['guest', 'member'].includes(viewerId); },
    async authorizeDirectAttachment({ viewerId }) { return allowed && ['owner', 'peer'].includes(viewerId); }
  });
  assert.equal((await service.open({ attachmentId: ID, variant: 'preview', viewerId: 'guest' })).mimeType, 'image/webp');
  assert.equal((await service.open({ attachmentId: ID, variant: 'processed', viewerId: 'member' })).bytes, 4);
  for (const viewerId of ['banned', 'left', 'outsider']) await assert.rejects(service.open({ attachmentId: ID, variant: 'preview', viewerId }), (error) => error.statusCode === 404);
  allowed = false;
  for (const reason of ['ban', 'leave', 'expiry']) await assert.rejects(service.open({ attachmentId: ID, variant: 'preview', viewerId: 'member' }), (error) => error.code === 'media_not_found', reason);
  row = attachment({ context: 'dm', roomMessageId: null, directMessageId: 'dm' }); allowed = true;
  assert.equal((await service.open({ attachmentId: ID, variant: 'preview', viewerId: 'peer' })).bytes, 4);
  await assert.rejects(service.open({ attachmentId: ID, variant: 'preview', viewerId: 'other' }));
  row = attachment({ deletedAt: new Date() }); await assert.rejects(service.open({ attachmentId: ID, variant: 'preview', viewerId: 'peer' }));
  row = attachment({ boundAt: null }); await service.requireVisible(row, 'owner'); await assert.rejects(service.requireVisible(row, 'peer'));
  await assert.rejects(service.open({ attachmentId: MISSING, variant: 'preview', viewerId: 'owner' }));
});

test('G82-A02 guessed and denied reads are indistinguishable 404 with private safe response headers', async (t) => {
  const app = fastify(); t.after(() => app.close());
  const visible = new Set([ID]);
  registerMediaRoutes({
    app, resolveUser: async (request) => ({ id: request.headers['x-viewer'] || 'member' }),
    mediaService: { async createSlot() {}, async upload() {}, async status() {}, async retry() {}, async remove() {} },
    mediaVisibilityService: { async open({ attachmentId }) { if (!visible.has(attachmentId)) { const error = new Error('Attachment not found'); error.code = 'media_not_found'; error.statusCode = 404; throw error; } return { bytes: 4, extension: 'webp', mimeType: 'image/webp', stream: 'data' }; } }
  });
  const started = performance.now();
  const ok = await app.inject({ method: 'GET', url: `/api/media/attachments/${ID}/preview` });
  const denied = await app.inject({ method: 'GET', url: `/api/media/attachments/${MISSING}/preview` });
  assert.equal(ok.statusCode, 200); assert.equal(ok.headers['cache-control'], 'private, no-store');
  assert.equal(ok.headers['content-type'], 'image/webp'); assert.match(ok.headers['content-disposition'], /^inline; filename="image\.webp"$/);
  assert.equal(denied.statusCode, 404); assert.deepEqual(denied.json(), { ok: false, code: 'media_not_found', error: 'Attachment not found' });
  assert.ok(performance.now() - started < 500);
  const server = require('node:fs').readFileSync(require.resolve('../src/server.js'), 'utf8');
  assert.doesNotMatch(server.match(/function publicAttachment[\s\S]*?\n\}/)?.[0] || '', /ownerId/);
});
