'use strict';

// The API -> bot half of the control plane, against a real HTTP server.
//
// The property under test is AC-9's: a bot that is absent, slow or broken must
// degrade to a result value, never to an exception and never to an unbounded
// wait, because these calls are awaited inside the WS message queue.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  MUSIC_BOT_SECRET_MIN_LENGTH,
  MUSIC_SECRET_HEADER,
  createMusicBotClient,
  normalizeMusicBotSecret
} = require('../src/domains/music/music-bot-client');
const {
  MUSIC_BOT_TOKEN_TTL_SECONDS,
  mintMusicBotToken,
  musicBotIdentityFor
} = require('../src/domains/music/music-bot-token');

const SECRET = 'music-bot-shared-secret-32-chars-min';

async function withServer(handler, run) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run({ baseUrl, requests });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

test('resolve sends the shared secret and returns the bot payload', async () => {
  await withServer(
    (req, res) => json(res, 200, { status: 'ok', items: [{ source: 'vk', videoId: '-1_2', title: 'T' }] }),
    async ({ baseUrl, requests }) => {
      const client = createMusicBotClient({ baseUrl, secret: SECRET });
      const result = await client.resolveLink('https://vkvideo.ru/video-1_2', 50);
      assert.equal(result.ok, true);
      assert.deepEqual(result.data.items, [{ source: 'vk', videoId: '-1_2', title: 'T' }]);
      assert.equal(requests[0].method, 'POST');
      assert.equal(requests[0].url, '/resolve');
      assert.equal(requests[0].headers[MUSIC_SECRET_HEADER], SECRET);
      assert.deepEqual(JSON.parse(requests[0].body), {
        link: 'https://vkvideo.ru/video-1_2',
        limit: 50
      });
    }
  );
});

test('a 4xx from the bot surfaces its error code without throwing', async () => {
  await withServer(
    (req, res) => json(res, 400, { status: 'error', error: 'invalid_link', message: 'nope' }),
    async ({ baseUrl }) => {
      const client = createMusicBotClient({ baseUrl, secret: SECRET });
      const result = await client.resolveLink('https://vkvideo.ru/video-1_2');
      assert.equal(result.ok, false);
      assert.equal(result.status, 400);
      assert.equal(result.botError, 'invalid_link');
      assert.equal(result.reason, 'rejected');
    }
  );
});

test('a hung bot is abandoned at the deadline instead of blocking the caller', async () => {
  await withServer(
    () => { /* never responds */ },
    async ({ baseUrl }) => {
      const client = createMusicBotClient({ baseUrl, secret: SECRET, controlTimeoutMs: 120 });
      const startedAt = Date.now();
      const result = await client.stop('room-1', null);
      assert.equal(result.ok, false);
      assert.equal(result.code, 'music_unavailable');
      assert.equal(result.reason, 'timeout');
      assert.ok(Date.now() - startedAt < 3000, 'the call must not wait for the hung response');
    }
  );
});

test('an unreachable bot fails open rather than throwing', async () => {
  // Port 1 is reserved and never listening.
  const client = createMusicBotClient({ baseUrl: 'http://127.0.0.1:1', secret: SECRET, controlTimeoutMs: 500 });
  const result = await client.play('room-1', { sessionEpoch: 0, item: {}, livekit: {} });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'music_unavailable');
});

test('a client without a configured URL or secret is disabled and never calls out', async () => {
  assert.equal(createMusicBotClient({ baseUrl: '', secret: SECRET }).enabled, false);
  assert.equal(createMusicBotClient({ baseUrl: 'http://bot', secret: '' }).enabled, false);
  const disabled = createMusicBotClient({ baseUrl: '', secret: '' });
  assert.deepEqual(await disabled.health(), {
    ok: false,
    code: 'music_unavailable',
    reason: 'not_configured'
  });
});

test('play passes the resolved room name and token; stop carries the epoch', async () => {
  await withServer(
    (req, res) => json(res, 202, { status: 'playing' }),
    async ({ baseUrl, requests }) => {
      const client = createMusicBotClient({ baseUrl, secret: SECRET });
      await client.play('room-1', {
        sessionEpoch: 3,
        item: {
          itemId: 'i1',
          source: 'vk',
          videoId: '-1_77',
          sourceUrl: 'https://vkvideo.ru/video-1_77',
          durationMs: 1000,
          title: 'T'
        },
        livekit: { roomName: 'voice-room-room-1', token: 'jwt', identity: 'music-bot:room-1' }
      });
      assert.equal(requests[0].url, '/sessions/room-1/play');
      const body = JSON.parse(requests[0].body);
      assert.equal(body.sessionEpoch, 3);
      assert.equal(body.livekit.roomName, 'voice-room-room-1');
      assert.equal(body.livekit.token, 'jwt');
      // The client is a transport: whatever the caller put in `item` reaches the
      // bot unchanged, so a field lost here would be lost silently.
      assert.equal(body.item.source, 'vk');
      assert.equal(body.item.videoId, '-1_77');
      assert.equal(body.item.sourceUrl, 'https://vkvideo.ru/video-1_77');

      await client.stop('room-1', 3);
      assert.equal(requests[1].method, 'DELETE');
      assert.equal(requests[1].url, '/sessions/room-1?sessionEpoch=3');
    }
  );
});

test('the bot token is scoped to one room and one publishable source', async () => {
  const identity = musicBotIdentityFor('room-1');
  const jwt = await mintMusicBotToken({
    apiKey: 'devkey',
    apiSecret: 'devsecretdevsecretdevsecretdevsecret',
    livekitRoom: 'voice-room-room-1',
    identity
  });
  assert.ok(jwt, 'a token must be issued');
  const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.sub, identity);
  assert.equal(claims.video.room, 'voice-room-room-1');
  assert.equal(claims.video.roomJoin, true);
  assert.equal(claims.video.canPublish, true);
  assert.equal(claims.video.canSubscribe, false);
  assert.equal(claims.video.canPublishData, false);
  assert.deepEqual(claims.video.canPublishSources, ['screen_share_audio']);

  // A plain bearer token with no gate binding and no single-use burn: anyone who
  // observes one can publish as the bot until it expires. The bot connects on
  // receipt, so the lifetime is minutes, not hours.
  assert.equal(claims.exp - claims.nbf, 5 * 60, 'the bot token must be short-lived');
  assert.equal(MUSIC_BOT_TOKEN_TTL_SECONDS, 5 * 60);

  assert.equal(await mintMusicBotToken({ apiKey: '', apiSecret: '', livekitRoom: '', identity: '' }), null);
});

test('a short MUSIC_BOT_SECRET is treated as unset rather than trusted', async () => {
  // `server.js` already refuses to serve LiveKit when the gate secret is under
  // 32 characters; compose's `:?` only proves the variable is set, so without
  // the same floor a deployment can ship `MUSIC_BOT_SECRET=x` and run a
  // guessable control plane.
  assert.equal(normalizeMusicBotSecret('x'), '');
  assert.equal(normalizeMusicBotSecret(`  ${SECRET}  `), SECRET);
  assert.ok(SECRET.length >= MUSIC_BOT_SECRET_MIN_LENGTH);

  const weak = createMusicBotClient({ baseUrl: 'http://bot', secret: 'short-secret' });
  assert.equal(weak.enabled, false, 'a secret under the floor must disable the client');
  assert.deepEqual(await weak.health(), {
    ok: false,
    code: 'music_unavailable',
    reason: 'not_configured'
  });
});
