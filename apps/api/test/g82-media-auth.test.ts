import assert from 'node:assert/strict';
import fastify from 'fastify';
import test from 'node:test';
import { registerMediaRoutes } from '../src/domains/media/media.routes.ts';
import type { ApiContext } from '../src/app/context.ts';
import { Readable } from 'node:stream';
import type { Attachment, AttachmentRepository } from '../src/domains/media/attachment-repository.ts';
import type { MediaService } from '../src/domains/media/media-service.ts';
import { createMediaVisibilityService } from '../src/domains/media/media-visibility-service.ts';
import type { MediaStorage } from '../src/domains/media/storage.ts';
import { attachment as attachmentRow, fake, spy, storedUser } from './fakes/index.ts';
const ID = '123e4567-e89b-42d3-a456-426614174000';
const MISSING = '223e4567-e89b-42d3-a456-426614174000';

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return attachmentRow({ id: ID, boundAt: new Date(), roomMessageId: 'message', ...overrides });
}

test('G82-A01 draft owner, room guest/member and DM participants are authorized; ban/leave/expiry/delete/cross-context deny immediately', async () => {
  let row = attachment();
  let allowed = true;
  const service = createMediaVisibilityService({
    attachmentRepository: fake<AttachmentRepository>({
      async findById(id) {
        return id === ID ? row : null;
      }
    }),
    storage: fake<MediaStorage>({
      async openRead() {
        return { key: `${ID}/preview`, bytes: 4, stream: Readable.from(['data']) };
      }
    }),
    async authorizeRoomAttachment({ viewerId }) {
      return allowed && ['guest', 'member'].includes(viewerId);
    },
    async authorizeDirectAttachment({ viewerId }) {
      return allowed && ['owner', 'peer'].includes(viewerId);
    }
  });
  assert.equal(
    (await service.open({ attachmentId: ID, variant: 'preview', viewerId: 'guest' })).mimeType,
    'image/webp'
  );
  assert.equal((await service.open({ attachmentId: ID, variant: 'processed', viewerId: 'member' })).bytes, 4);
  for (const viewerId of ['banned', 'left', 'outsider'])
    await assert.rejects(service.open({ attachmentId: ID, variant: 'preview', viewerId }), { statusCode: 404 });
  allowed = false;
  for (const reason of ['ban', 'leave', 'expiry'])
    await assert.rejects(
      service.open({ attachmentId: ID, variant: 'preview', viewerId: 'member' }),
      { code: 'media_not_found' },
      reason
    );
  row = attachment({ context: 'dm', roomMessageId: null, directMessageId: 'dm' });
  allowed = true;
  assert.equal((await service.open({ attachmentId: ID, variant: 'preview', viewerId: 'peer' })).bytes, 4);
  await assert.rejects(service.open({ attachmentId: ID, variant: 'preview', viewerId: 'other' }));
  row = attachment({ deletedAt: new Date() });
  await assert.rejects(service.open({ attachmentId: ID, variant: 'preview', viewerId: 'peer' }));
  row = attachment({ boundAt: null });
  await service.requireVisible(row, 'owner');
  await assert.rejects(service.requireVisible(row, 'peer'));
  await assert.rejects(service.open({ attachmentId: MISSING, variant: 'preview', viewerId: 'owner' }));
});

test('G82-A02 guessed and denied reads are indistinguishable 404 with private safe response headers', async (t) => {
  const app = fastify();
  t.after(() => app.close());
  const visible = new Set([ID]);
  registerMediaRoutes(app, fake<ApiContext>({ resolveSession: async () => ({ user: storedUser({ id: 'member' }) }) }), {
    media: spy<MediaService>([]),
    uploadsEnabled: () => true,
    readsEnabled: () => true,
    visibility: {
      async open({ attachmentId }) {
        if (!visible.has(attachmentId)) {
          throw Object.assign(new Error('Attachment not found'), { code: 'media_not_found', statusCode: 404 });
        }
        return { bytes: 4, extension: 'webp', mimeType: 'image/webp', stream: Readable.from(['data']) };
      }
    }
  });
  const started = performance.now();
  const ok = await app.inject({ method: 'GET', url: `/api/media/attachments/${ID}/preview` });
  const denied = await app.inject({ method: 'GET', url: `/api/media/attachments/${MISSING}/preview` });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['cache-control'], 'private, no-store');
  assert.equal(ok.headers['content-type'], 'image/webp');
  assert.match(String(ok.headers['content-disposition']), /^inline; filename="image\.webp"$/);
  assert.equal(denied.statusCode, 404);
  assert.deepEqual(denied.json(), { ok: false, code: 'media_not_found', error: 'Attachment not found' });
  assert.ok(performance.now() - started < 500);
});
