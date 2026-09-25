import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';

import { registerMediaRoutes } from '../src/domains/media/media-routes.ts';
import type { MediaService } from '../src/domains/media/media-service.ts';
import { spy } from './fakes/index.ts';

function createApp() {
  const calls: string[] = [];
  const app = fastify();
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));
  registerMediaRoutes({
    app,
    mediaService: spy<MediaService>(calls),
    mediaVisibilityService: spy<{ open: () => Promise<never> }>(calls),
    resolveUser: async () => ({ id: 'user-1' })
  });
  return { app, calls };
}

test('media routes reject invalid attachment ids before services see them', async (t) => {
  const { app, calls } = createApp();
  t.after(() => app.close());

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
    assert.equal(response.json().code, 'media_attachment_id_invalid');
  }

  assert.deepEqual(calls, []);
});
