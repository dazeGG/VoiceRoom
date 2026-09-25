// The operational routes are the first group served by Fastify-native handlers
// instead of runLegacyHandler. These pin that nothing a client or operator
// relies on changed in the move: bodies, security headers, no-store caching,
// request ids, the request metric and the `{ ok: false, error }` failure shape.

import test, { type TestContext } from 'node:test';
import type { LightMyRequestResponse } from 'fastify';
import assert from 'node:assert/strict';

const { createApiApp } = await import('../src/server.ts');
const { createDesktopReleaseService, isDesktopReleaseDownloadUrl, normalizeRelease } =
  await import('../src/domains/ops/desktop-release.service.ts');

function createStore() {
  return {
    async countRooms() {
      return 0;
    },
    async getRoom() {
      return null;
    },
    async listSummaryRecipientUserIds() {
      return [];
    },
    async markRoomActive() {},
    async markRoomEmpty() {},
    async pruneRooms() {}
  };
}

function createApp(t: TestContext) {
  const app = createApiApp({
    store: createStore(),
    users: {
      async getSessionUser() {
        return null;
      }
    }
  });
  t.after(() => app.close());
  return app;
}

function assertSecurityHeaders(response: LightMyRequestResponse) {
  assert.match(String(response.headers['content-security-policy']), /default-src 'self'/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(response.headers['x-request-id']);
}

test('health keeps its public shape, headers and request id', async (t) => {
  const app = createApp(t);
  const response = await app.inject({ method: 'GET', url: '/api/healthz' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.livekit, 'boolean');
  assert.deepEqual(Object.keys(body.capabilityManifest).sort(), [
    'contractVersion',
    'digest',
    'manifestRawSha256',
    'replicaConsensus',
    'schemaVersion'
  ]);
  assert.equal(body.livekitUrl, undefined, 'the internal LiveKit address is not public');
  assertSecurityHeaders(response);
});

test('the proof-of-work challenge carries what the client solves', async (t) => {
  const app = createApp(t);
  const response = await app.inject({ method: 'GET', url: '/api/pow-challenge' });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  if (body.required) {
    assert.equal(body.algorithm, 'sha256');
    assert.equal(typeof body.challenge, 'string');
    assert.ok(body.difficulty > 0);
    assert.ok(body.expiresAt > Date.now());
  } else {
    assert.deepEqual(body, { ok: true, required: false });
  }
  assertSecurityHeaders(response);
});

test('disabled client log intake answers the legacy 404 shape', async (t) => {
  const app = createApp(t);
  const response = await app.inject({ method: 'POST', url: '/api/client-logs', payload: { events: [] } });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { ok: false, error: 'Not found' });
  assertSecurityHeaders(response);
});

test('a malformed JSON body fails with the shared failure shape', async (t) => {
  const app = createApp(t);
  const response = await app.inject({
    method: 'POST',
    url: '/api/client-logs',
    headers: { 'content-type': 'application/json' },
    payload: '{"events":'
  });
  assert.equal(response.statusCode, 400);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, 'string');
});

test('native routes are counted in the request metric exactly once', async (t) => {
  const app = createApp(t);
  const before = await app.inject({ method: 'GET', url: '/api/metrics' });
  const count = (text: string) =>
    Number(/voice_room_api_http_requests_total\{[^}]*route="\/api\/pow-challenge"[^}]*\} (\d+)/.exec(text)?.[1] || 0);
  const start = count(before.body);
  await app.inject({ method: 'GET', url: '/api/pow-challenge' });
  const after = await app.inject({ method: 'GET', url: '/api/metrics' });
  assert.match(String(after.headers['content-type']), /^text\/plain; version=0\.0\.4/);
  assert.equal(count(after.body), start + 1);
});

const REPO = 'dazeGG/VoiceRoomDesktop';
const githubRelease = {
  tag_name: 'v1.4.0',
  html_url: `https://github.com/${REPO}/releases/tag/v1.4.0`,
  assets: [
    {
      name: 'VoiceRoom-1.4.0-mac-arm64.dmg',
      browser_download_url: `https://github.com/${REPO}/releases/download/v1.4.0/VoiceRoom-1.4.0-mac-arm64.dmg`,
      size: 10
    },
    {
      name: 'VoiceRoom-1.4.0-win-x64.exe',
      browser_download_url: `https://github.com/${REPO}/releases/download/v1.4.0/VoiceRoom-1.4.0-win-x64.exe`,
      size: 20
    },
    {
      name: 'VoiceRoom-1.4.0-win-x64-setup.exe',
      browser_download_url: `https://github.com/${REPO}/releases/download/v1.4.0/VoiceRoom-1.4.0-win-x64-setup.exe`,
      size: 30
    },
    {
      name: 'VoiceRoom-1.4.0-mac-x64.dmg',
      browser_download_url: 'https://evil.example/VoiceRoom-1.4.0-mac-x64.dmg',
      size: 40
    }
  ]
};

test("the release manifest keeps only this repository's download URLs and prefers the installer", () => {
  const release = normalizeRelease(githubRelease, REPO);
  assert.equal(release.version, '1.4.0');
  assert.equal(release.assets['win-x64']?.size, 30);
  assert.equal(release.assets['mac-arm64']?.size, 10);

  assert.equal(release.assets['mac-x64'], null, 'a download outside the repository is dropped');
  assert.equal(isDesktopReleaseDownloadUrl(`https://github.com/${REPO}/releases/download/x`, REPO), true);
  assert.equal(isDesktopReleaseDownloadUrl('https://github.com/other/repo/releases/download/x', REPO), false);
  assert.equal(isDesktopReleaseDownloadUrl('not a url', REPO), false);
});

test('the release service caches, serves stale data on failure and reports an outage', async () => {
  let now = 0;
  let calls = 0;
  let fail = false;
  const warnings: Array<{ evt?: string }> = [];
  const service = createDesktopReleaseService({
    repo: REPO,
    cacheMs: 1_000,
    timeoutMs: 1_000,
    now: () => now,
    logger: { warn: (fields: { evt?: string }) => warnings.push(fields) },
    fetch: async () => {
      calls += 1;
      if (fail) throw new Error('offline');
      return new Response(JSON.stringify(githubRelease), { status: 200 });
    }
  });

  const first = await service.latest();
  assert.equal(first.status, 'ok');
  assert.equal(first.cacheControl, 'public, max-age=300');
  await service.latest();
  assert.equal(calls, 1, 'a fresh cache answers without GitHub');

  now = 5_000;
  fail = true;
  const stale = await service.latest();
  assert.equal(stale.status, 'ok');
  assert.equal(stale.cacheControl, 'public, max-age=60');
  assert.equal(warnings.length, 0);

  const empty = createDesktopReleaseService({
    repo: REPO,
    cacheMs: 1_000,
    timeoutMs: 1_000,
    logger: { warn: (fields: { evt?: string }) => warnings.push(fields) },
    fetch: async () => new Response('', { status: 503 })
  });
  assert.deepEqual(await empty.latest(), { status: 'unavailable' });
  assert.equal(warnings[0]?.evt, 'desktop.release_fetch_failed');
});
