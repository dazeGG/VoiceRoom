'use strict';

// The bot -> API control plane, over the real HTTP surface.
//
// Network placement is not authentication: these routes are reachable only from
// inside the compose network in production, and they still demand the shared
// secret. This file is the proof that removing the header does not open them.

const test = require('node:test');
const assert = require('node:assert/strict');

const SECRET = 'internal-music-shared-secret-32ch';
process.env.MUSIC_BOT_SECRET = SECRET;

const { MUSIC_SECRET_HEADER } = require('../src/domains/music/music-bot-client');
const { createApiApp } = require('../src/server');

const TRACK_ENDED = '/internal/rooms/room-abc/music/track-ended';
const HEARTBEAT = '/internal/rooms/room-abc/music/heartbeat';

let app;

test.before(async () => {
  app = createApiApp();
  await app.ready();
});

test.after(async () => {
  await app?.close();
});

function post(url, { secret = SECRET, payload = {} } = {}) {
  return app.inject({
    method: 'POST',
    url,
    headers: secret == null ? {} : { [MUSIC_SECRET_HEADER]: secret },
    payload
  });
}

test('a callback without the shared secret is rejected', async () => {
  for (const url of [TRACK_ENDED, HEARTBEAT]) {
    const missing = await post(url, { secret: null });
    assert.equal(missing.statusCode, 401, `${url} must not accept an unauthenticated caller`);

    const wrong = await post(url, { secret: 'not-the-secret' });
    assert.equal(wrong.statusCode, 401, `${url} must not accept the wrong secret`);

    // A secret of a different length must not leak through the comparison.
    const short = await post(url, { secret: 'x' });
    assert.equal(short.statusCode, 401);
  }
});

test('an authenticated callback with a malformed payload is a 400', async () => {
  const noEpoch = await post(TRACK_ENDED, { payload: { itemId: 'i1' } });
  assert.equal(noEpoch.statusCode, 400);

  const noItem = await post(TRACK_ENDED, { payload: { sessionEpoch: 1 } });
  assert.equal(noItem.statusCode, 400);

  const negative = await post(HEARTBEAT, { payload: { sessionEpoch: -1, itemId: 'i1' } });
  assert.equal(negative.statusCode, 400);
});

test('a callback for a session the server does not own is 409, so the bot leaves', async () => {
  const ended = await post(TRACK_ENDED, { payload: { sessionEpoch: 7, itemId: 'i1' } });
  assert.equal(ended.statusCode, 409);
  assert.equal(ended.json().code, 'stale');

  const beat = await post(HEARTBEAT, { payload: { sessionEpoch: 7, itemId: 'i1', positionMs: 100 } });
  assert.equal(beat.statusCode, 409);
  assert.equal(beat.json().code, 'stale');
});

test('the internal prefix is not part of the browser API surface', async () => {
  const viaApi = await post('/api/internal/rooms/room-abc/music/track-ended');
  assert.equal(viaApi.statusCode, 404);
});
