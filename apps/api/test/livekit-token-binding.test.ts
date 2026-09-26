// The gate credential and the LiveKit JWT are issued together for one
// admission. These cases pin that the gate refuses to tunnel a JWT that belongs
// to another peer, another room, or an admission older than the credential —
// the replays that would otherwise bypass a ban, a server mute or a logout.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http, { type IncomingHttpHeaders } from 'node:http';
import net from 'node:net';
import test from 'node:test';

import {
  extractAccessToken,
  getLiveKitRoomName,
  normalizeLiveKitRoomPrefix,
  verifyAccessTokenBinding
} from '../src/domains/admission/livekit-token-binding.mts';
import { createLiveKitAuthGateService } from '../src/domains/admission/livekit-auth-gate.service.ts';
import type { GateClaims } from '../src/domains/admission/gate-credential-signer.ts';
import { recordingLogger } from './fakes/index.ts';

const NOW = Date.now();
const CLAIMS: GateClaims = {
  cid: 'cid-1',
  exp: NOW + 60_000,
  iat: NOW,
  peer: 'peer-a',
  pEpoch: 1,
  pId: 'room-a:peer-a',
  pType: 'guest',
  room: 'room-a'
};
const BOUNDARY = {
  assertReady: async () => true as const,
  authorizeCredential: async () => ({ ok: true as const, claims: CLAIMS })
};

// The refusal code of a check, or undefined when it passed.
function codeOf(result: { ok: true } | { ok: false; code: string }) {
  return result.ok ? undefined : result.code;
}

function portOf(server: net.Server) {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

function jwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`;
}

function tokenFor({
  sub = 'peer-a',
  room = 'voice-room-room-a',
  nbf = Math.floor(NOW / 1000)
}: { sub?: string; room?: string; nbf?: number } = {}) {
  return jwt({ sub, nbf, video: { room } });
}

function verify({
  token = tokenFor(),
  headers = {},
  url
}: { token?: string; headers?: IncomingHttpHeaders; url?: string } = {}) {
  return verifyAccessTokenBinding({
    claims: CLAIMS,
    headers,
    requestUrl: url || `/rtc?access_token=${token}&vr_gate_credential=x`,
    roomPrefix: 'voice-room-'
  });
}

test('a JWT minted for the same admission passes', () => {
  assert.deepEqual(verify(), { ok: true });
});

test('a JWT refreshed by LiveKit later in the call still passes', () => {
  assert.deepEqual(verify({ token: tokenFor({ nbf: Math.floor(NOW / 1000) + 3600 }) }), { ok: true });
});

test('a JWT for another peer is refused', () => {
  assert.equal(codeOf(verify({ token: tokenFor({ sub: 'peer-b' }) })), 'identity_mismatch');
});

test('a JWT for a room the credential was not issued for is refused (ban bypass)', () => {
  assert.equal(codeOf(verify({ token: tokenFor({ room: 'voice-room-room-b' }) })), 'room_mismatch');
});

test('a JWT issued before the credential is refused (server-mute replay)', () => {
  assert.equal(codeOf(verify({ token: tokenFor({ nbf: Math.floor((NOW - 60_000) / 1000) }) })), 'stale_token');
});

test('one second of nbf rounding is inside the allowed skew', () => {
  assert.deepEqual(verify({ token: tokenFor({ nbf: Math.floor(NOW / 1000) - 1 }) }), { ok: true });
});

test('a missing, malformed or claim-less token is refused', () => {
  assert.equal(codeOf(verify({ url: '/rtc?vr_gate_credential=x' })), 'missing_token');
  assert.equal(codeOf(verify({ token: 'not-a-jwt' })), 'malformed_token');
  assert.equal(codeOf(verify({ token: 'a.%%%.c' })), 'malformed_token');
  assert.equal(codeOf(verify({ token: jwt({ nbf: 1 }) })), 'identity_mismatch');
  assert.equal(codeOf(verify({ token: jwt({ sub: 'peer-a', nbf: Math.floor(NOW / 1000) }) })), 'room_mismatch');
  assert.equal(codeOf(verify({ token: jwt({ sub: 'peer-a', video: { room: 'voice-room-room-a' } }) })), 'stale_token');
  assert.equal(codeOf(verifyAccessTokenBinding({ requestUrl: '/rtc' })), 'missing_claims');
});

test('the Authorization header is what LiveKit reads, so it is what gets checked', () => {
  const headers = { authorization: `Bearer ${tokenFor()}` };
  assert.deepEqual(verify({ headers, url: '/rtc?vr_gate_credential=x' }), { ok: true });
  const foreign = { authorization: `Bearer ${tokenFor({ room: 'voice-room-room-b' })}` };
  assert.equal(codeOf(verify({ headers: foreign, url: '/rtc?vr_gate_credential=x' })), 'room_mismatch');
});

test('ambiguous token sources are refused instead of guessing', () => {
  const good = tokenFor();
  const other = tokenFor({ room: 'voice-room-room-b' });
  assert.equal(codeOf(extractAccessToken(`/rtc?access_token=${good}&access_token=${other}`)), 'ambiguous_token');
  assert.equal(
    codeOf(extractAccessToken(`/rtc?access_token=${good}`, { authorization: `Bearer ${other}` })),
    'ambiguous_token'
  );
  assert.equal(codeOf(extractAccessToken('/rtc', { authorization: 'Basic abc' })), 'malformed_authorization');
  assert.equal(
    codeOf(extractAccessToken('/rtc', { authorization: ['Bearer a', 'Bearer b'] as never })),
    'malformed_authorization'
  );
  assert.deepEqual(extractAccessToken(`/rtc?access_token=${good}`, { authorization: `Bearer ${good}` }), {
    ok: true,
    token: good
  });
});

test('room names follow the configured prefix with the same sanitising as before', () => {
  assert.equal(normalizeLiveKitRoomPrefix(undefined), 'voice-room-');
  assert.equal(normalizeLiveKitRoomPrefix('a b/c-'), 'a-b-c-');
  assert.equal(getLiveKitRoomName('room-1', 'vr-'), 'vr-room-1');
});

class FakeSocket extends EventEmitter {
  destroyed = false;
  writable = true;
  writableEnded = false;
  writes: string[] = [];

  write(data: string | Buffer) {
    this.writes.push(data.toString());
    return true;
  }

  end(data?: string | Buffer) {
    if (data !== undefined) this.writes.push(data.toString());
    this.writableEnded = true;
  }

  destroy() {
    this.destroyed = true;
  }

  pipe<T>(target: T): T {
    return target;
  }
}

test('the gate answers 403 and never dials LiveKit for a foreign JWT', async (t) => {
  const logger = recordingLogger();
  const gate = createLiveKitAuthGateService({
    boundary: BOUNDARY,
    logger,
    roomPrefix: 'voice-room-',
    roomStore: {},
    upstreamUrl: 'ws://livekit:7880'
  });
  let dialed = false;
  t.mock.method(net, 'connect', () => {
    dialed = true;
    return new FakeSocket();
  });
  const server = gate.createServer();
  const client = new FakeSocket();
  const token = tokenFor({ room: 'voice-room-room-b' });
  server.emit(
    'upgrade',
    { url: `/rtc?access_token=${token}&vr_gate_credential=x`, headers: {} },
    client,
    Buffer.alloc(0)
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(dialed, false);
  assert.match(client.writes.join(''), /^HTTP\/1\.1 403 Forbidden/);
  assert.deepEqual(
    logger.records.filter((entry) => entry.level === 'warn').map((entry) => [entry.evt, entry.code]),
    [['livekit.gate_denied', 'room_mismatch']]
  );
});

test('credential-only authorize calls keep checking just the credential', async () => {
  const gate = createLiveKitAuthGateService({
    boundary: BOUNDARY,
    roomStore: {},
    upstreamUrl: 'ws://livekit:7880'
  });
  assert.equal((await gate.authorize('/rtc?vr_gate_credential=x')).ok, true);
  assert.equal(codeOf(await gate.authorize('/rtc?vr_gate_credential=x', {})), 'missing_token');
});

test('the validate probe is admitted like the upgrade and proxied without the gate credential', async (t) => {
  const seen: string[] = [];
  const upstream = http.createServer((req, res) => {
    seen.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('success');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => upstream.close());
  const gate = createLiveKitAuthGateService({
    boundary: BOUNDARY,
    logger: recordingLogger(),
    roomPrefix: 'voice-room-',
    roomStore: {},
    upstreamUrl: `ws://127.0.0.1:${portOf(upstream)}`
  }).createServer();
  await new Promise<void>((resolve) => gate.listen(0, '127.0.0.1', resolve));
  t.after(() => gate.close());
  const base = `http://127.0.0.1:${portOf(gate)}`;

  const ok = await fetch(`${base}/rtc/v1/validate?access_token=${tokenFor()}&vr_gate_credential=x`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'success');
  assert.equal(ok.headers.get('access-control-allow-origin'), '*', 'the web origin must be able to read the answer');
  assert.deepEqual(seen, [`/rtc/v1/validate?access_token=${tokenFor()}`]);

  const foreign = await fetch(
    `${base}/rtc/validate?access_token=${tokenFor({ room: 'voice-room-room-b' })}&vr_gate_credential=x`
  );
  assert.equal(foreign.status, 403);
  assert.equal(foreign.headers.get('access-control-allow-origin'), '*');
  assert.equal(seen.length, 1, 'a refused probe never reaches LiveKit');

  assert.equal((await fetch(`${base}/rtc/other`)).status, 404);
});
