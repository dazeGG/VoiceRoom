// Image attachments over HTTP on a bare Fastify app: ids are checked before
// any service runs, the owner always comes from the session, and service
// refusals keep their status and code.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';

import type { Failure } from '@voice-room/shared/contracts/http';
import type { AttachmentAnswer, AttachmentDraft } from '@voice-room/shared/contracts/media';
import type { ApiContext } from '../src/app/context.ts';
import { registerMediaRoutes } from '../src/domains/media/media.routes.ts';
import type { MediaService } from '../src/domains/media/media.service.ts';
import { AJV_OPTIONS, registerHttpKit } from '../src/platform/http/http-kit.ts';
import { fake, spy, storedUser } from './fakes/index.ts';

const ID = '123e4567-e89b-42d3-a456-426614174000';

function draft(overrides: Partial<AttachmentDraft> = {}): AttachmentDraft {
  return {
    id: ID,
    context: 'room',
    state: 'pending',
    mimeType: null,
    bytes: 10,
    width: null,
    height: null,
    failureCode: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

function mediaApp(
  t: TestContext,
  media: MediaService,
  { signedIn = true, uploads = true }: { signedIn?: boolean; uploads?: boolean } = {}
) {
  const app = fastify({ ajv: AJV_OPTIONS });
  t.after(() => app.close());
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));
  registerMediaRoutes(
    app,
    fake<ApiContext>({ resolveSession: async () => (signedIn ? { user: storedUser({ id: 'owner-1' }) } : null) }),
    {
      media,
      visibility: spy<{ open: () => Promise<never> }>([]),
      uploadsEnabled: () => uploads,
      readsEnabled: () => true
    }
  );
  return app;
}

test('media routes reject invalid attachment ids before services see them', async (t) => {
  const calls: string[] = [];
  const app = mediaApp(t, spy<MediaService>(calls));
  for (const [method, url] of [
    ['PUT', '/api/media/attachments/not-a-uuid/content'],
    ['GET', '/api/media/attachments/not-a-uuid'],
    ['POST', '/api/media/attachments/not-a-uuid/retry'],
    ['DELETE', '/api/media/attachments/not-a-uuid'],
    ['GET', '/api/media/attachments/not-a-uuid/preview']
  ] as const) {
    const response = await app.inject({
      method,
      url,
      headers: method === 'PUT' ? { 'content-type': 'application/octet-stream' } : undefined,
      payload: method === 'PUT' ? 'body' : undefined
    });
    assert.equal(response.statusCode, 400, `${method} ${url}`);
    assert.equal(response.json<Failure>().code, 'media_attachment_id_invalid');
  }
  assert.deepEqual(calls, []);
});

test('a slot always belongs to the signed-in account, whatever the body says', async (t) => {
  const seen: unknown[] = [];
  const app = mediaApp(
    t,
    fake<MediaService>({
      async createSlot(input) {
        seen.push(input);
        return draft();
      }
    })
  );
  const response = await app.inject({
    method: 'POST',
    url: '/api/media/attachments',
    payload: { context: 'room', clientRequestId: 'r-1', bytes: 10, ownerId: 'victim' }
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json<AttachmentAnswer>(), { ok: true, attachment: draft() });
  assert.deepEqual(seen, [{ ownerId: 'owner-1', context: 'room', clientRequestId: 'r-1', bytes: 10 }]);
});

test('owner operations answer the draft, and refusals keep their status and code', async (t) => {
  const refused = Object.assign(new Error('Image exceeds 10 MiB'), { statusCode: 413, code: 'media_too_large' });
  const app = mediaApp(
    t,
    fake<MediaService>({
      status: async ({ id }) => draft({ id, state: 'ready' }),
      retry: async () => draft({ state: 'processing' }),
      remove: async () => null,
      upload: async () => {
        throw refused;
      },
      createSlot: async () => {
        throw new Error('database password is hunter2');
      }
    })
  );
  const status = await app.inject({ method: 'GET', url: `/api/media/attachments/${ID}` });
  assert.equal(status.json<AttachmentAnswer>().attachment.state, 'ready');
  const retry = await app.inject({ method: 'POST', url: `/api/media/attachments/${ID}/retry` });
  assert.equal(retry.json<AttachmentAnswer>().attachment.state, 'processing');
  const removed = await app.inject({ method: 'DELETE', url: `/api/media/attachments/${ID}` });
  assert.deepEqual([removed.statusCode, removed.json<Failure>().code], [404, 'media_not_found']);
  const upload = await app.inject({
    method: 'PUT',
    url: `/api/media/attachments/${ID}/content`,
    headers: { 'content-type': 'application/octet-stream' },
    payload: 'bytes'
  });
  assert.deepEqual(upload.json(), { ok: false, error: 'Image exceeds 10 MiB', code: 'media_too_large' });
  const crashed = await app.inject({ method: 'POST', url: '/api/media/attachments', payload: {} });
  assert.deepEqual(
    [crashed.statusCode, crashed.json()],
    [500, { ok: false, error: 'Internal server error', code: 'media_error' }]
  );
});

test('uploads need the feature switched on and every route needs a session', async (t) => {
  const off = mediaApp(t, spy<MediaService>([]), { uploads: false });
  const disabled = await off.inject({ method: 'POST', url: '/api/media/attachments', payload: {} });
  assert.deepEqual([disabled.statusCode, disabled.json<Failure>().code], [503, 'media_uploads_disabled']);
  const anonymous = mediaApp(t, spy<MediaService>([]), { signedIn: false });
  for (const [method, url] of [
    ['POST', '/api/media/attachments'],
    ['GET', `/api/media/attachments/${ID}`],
    ['GET', `/api/media/attachments/${ID}/preview`]
  ] as const) {
    assert.equal((await anonymous.inject({ method, url })).statusCode, 401, url);
  }
});
