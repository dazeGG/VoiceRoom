'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fastify = require('fastify');

const { registerMediaRoutes } = require('../src/domains/media/media-routes');

function createApp() {
  const calls = [];
  const app = fastify();
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));
  registerMediaRoutes({
    app,
    mediaService: {
      async upload(input) { calls.push(['upload', input]); return { id: input.id }; },
      async status(input) { calls.push(['status', input]); return { id: input.id }; },
      async retry(input) { calls.push(['retry', input]); return { id: input.id }; },
      async remove(input) { calls.push(['remove', input]); return { id: input.id }; },
      async createSlot(input) { calls.push(['createSlot', input]); return { id: 'slot' }; }
    },
    mediaVisibilityService: {
      async open(input) { calls.push(['open', input]); return { bytes: 0, extension: 'webp', mimeType: 'image/webp', stream: '' }; }
    },
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
  ]) {
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
