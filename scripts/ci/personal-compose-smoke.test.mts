import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { LiveKitAdmission } from '@voice-room/shared/contracts/admission';
import type { ClientCommands, ClientCommandType, ServerFrame } from '@voice-room/shared/contracts/realtime';
import { MeetOwnerAuthorization, MeetRoomCreated } from '@voice-room/shared/contracts/rooms';
import { parseServerFrame } from '@voice-room/shared/realtime';
import { Value } from 'typebox/value';
import WebSocket from 'ws';

const project = process.env.PERSONAL_SMOKE_PROJECT;
const origin = process.env.PERSONAL_ORIGIN;
assert.ok(project && origin, 'Set PERSONAL_SMOKE_PROJECT and PERSONAL_ORIGIN for the clean smoke stack');
const site = new URL(origin);
assert.equal(site.hostname, '127.0.0.1');
assert.equal(site.protocol, 'http:');

function compose(...args: string[]): string {
  return execFileSync('docker', ['compose', '-p', project ?? '', '-f', 'docker-compose.personal.yml', ...args], {
    encoding: 'utf8',
    timeout: 30000
  }).trim();
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(new URL(path, site), { ...init, signal: AbortSignal.timeout(7000) });
}

function post(path: string, body?: object, authorization?: string): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: {
      Origin: site.origin,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(authorization ? { Authorization: `Bearer ${authorization}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

function nextFrame<T extends ServerFrame['type']>(socket: WebSocket, type: T) {
  return new Promise<Extract<ServerFrame, { type: T }>>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', handleFrame);
      reject(new Error(`Missing ${type} frame`));
    }, 7000);
    const ofType = (frame: ServerFrame): frame is Extract<ServerFrame, { type: T }> => frame.type === type;
    function handleFrame(raw: WebSocket.RawData) {
      const bytes = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      const parsed = parseServerFrame(JSON.parse(bytes.toString('utf8')));
      if (!parsed.ok || !ofType(parsed.frame)) return;
      clearTimeout(timer);
      socket.off('message', handleFrame);
      resolve(parsed.frame);
    }
    socket.on('message', handleFrame);
  });
}

function send<T extends ClientCommandType>(socket: WebSocket, type: T, payload: ClientCommands[T]): void {
  socket.send(JSON.stringify({ type, payload }));
}

async function until(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(250);
  }
  assert.fail(message);
}

function ownerLinkToken(...args: string[]): string {
  const link = new URL(compose('exec', '-T', 'api', 'node', 'apps/api/src/scripts/owner-link.ts', ...args));
  assert.equal(link.origin, site.origin);
  const token = new URLSearchParams(link.hash.slice(1)).get('owner');
  assert.ok(token);
  return token;
}

function databaseSnapshot(): string {
  return compose(
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'voice_room',
    '-d',
    'voice_room',
    '-Atc',
    `SELECT
      (SELECT count(*) FROM rooms WHERE kind = 'meet'),
      (SELECT count(*) FROM room_peer_identities),
      (SELECT count(*) FROM room_peer_identities WHERE display_name <> ''),
      (SELECT count(*) FROM livekit_gate_credentials),
      (SELECT count(*) FROM voice_sessions),
      (SELECT count(*) FROM product_snapshots),
      (SELECT count(*) FROM system_snapshots),
      (SELECT count(*) FROM user_activity_days)`
  );
}

test('personal edge serves a protected document and only the personal HTTP surface', async () => {
  await until(async () => {
    try {
      return (await request('/api/readyz')).ok;
    } catch {
      return false;
    }
  }, 'Caddy could not reach the ready personal API');
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<h1>VoiceRoom Meet<\/h1>/);
  assert.match(page.headers.get('content-security-policy') ?? '', /(?:^|; )frame-ancestors 'none'(?:;|$)/);
  assert.match(page.headers.get('permissions-policy') ?? '', /display-capture=\(self\)/);
  assert.equal(page.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  for (const path of [
    '/api/metrics',
    '/api/admin/overview',
    '/api/rooms/sample/chat/history',
    '/embed/v1',
    '/widget/v1/loader.js'
  ])
    assert.equal((await request(path)).status, 404, path);
  assert.equal((await post('/api/rooms', {})).status, 404);
  assert.equal((await post('/api/widget/rooms', {})).status, 404);
  const config = await request('/runtime-config.json');
  assert.equal(config.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await config.json(), {
    contractVersion: 'voice-room.runtime-config/v1',
    schemaVersion: 1,
    livekit: { wsUrl: `ws://${site.host}`, connectFallbacks: [] }
  });
});

test('owner, guest socket and signaling gate work together on a clean personal stack', async (t) => {
  assert.equal(databaseSnapshot(), '0|0|0|0|0|0|0|0');
  assert.equal((await post('/api/meet/rooms')).status, 401);
  const ownerToken = ownerLinkToken();
  const exchangeResponse = await post('/api/meet/owner/exchange', { token: ownerToken });
  assert.equal(exchangeResponse.status, 200);
  const exchange: unknown = await exchangeResponse.json();
  assert.ok(Value.Check(MeetOwnerAuthorization, exchange), 'Owner exchange should match its wire contract');
  const grant = exchange.token;
  assert.ok([401, 403].includes((await post('/api/meet/owner/exchange', { token: ownerToken })).status));
  const createResponse = await post('/api/meet/rooms', undefined, grant);
  assert.equal(createResponse.status, 201);
  const created: unknown = await createResponse.json();
  assert.ok(Value.Check(MeetRoomCreated, created), 'Meet creation should match its wire contract');
  const joinUrl = new URL(created.joinUrl);
  assert.equal(joinUrl.origin, site.origin);
  assert.equal(joinUrl.pathname, `/room/${created.roomId}`);
  assert.equal(joinUrl.search + joinUrl.hash, '');
  assert.equal((await request(joinUrl.pathname)).status, 200);
  const statusPath = `/api/meet/rooms/${created.roomId}/status`;
  assert.equal((await request(statusPath)).status, 200);

  const socket = new WebSocket(`ws://${site.host}/api/meet/ws`, { origin: site.origin, handshakeTimeout: 7000 });
  t.after(() => socket.terminate());
  const [, ready] = await Promise.all([once(socket, 'open'), nextFrame(socket, 'ready')]);
  assert.equal(ready.payload.guest, true);
  const guest = {
    roomId: created.roomId,
    peerId: 'smoke-guest',
    name: 'Smoke Private Name',
    sessionToken: randomUUID()
  };
  const snapshot = nextFrame(socket, 'room.snapshot');
  send(socket, 'room.join', guest);
  assert.equal((await snapshot).payload.peers.find(({ id }) => id === guest.peerId)?.name, guest.name);
  const forbidden = nextFrame(socket, 'error');
  send(socket, 'room.preview.subscribe', { roomId: guest.roomId });
  assert.equal((await forbidden).error.code, 'forbidden');
  const admissionResponse = await post('/api/meet/livekit-token', guest);
  assert.equal(admissionResponse.status, 200);
  const admission: unknown = await admissionResponse.json();
  assert.ok(Value.Check(LiveKitAdmission, admission), 'Media admission should match its wire contract');
  assert.equal(databaseSnapshot(), '1|1|0|1|0|0|0|0');

  const rotated = ownerLinkToken('--rotate');
  assert.ok(rotated !== ownerToken, 'Rotation should issue a fresh link');
  assert.ok([401, 403].includes((await post('/api/meet/rooms', undefined, grant)).status));

  const signalUrl = new URL(admission.url);
  const gateCredential = signalUrl.searchParams.get('vr_gate_credential');
  assert.ok(gateCredential, 'Media admission should carry a gate credential');
  assert.equal(signalUrl.host, site.host);
  const validateUrl = new URL('/rtc/validate', site);
  validateUrl.searchParams.set('access_token', admission.token);
  const denied = await fetch(validateUrl, { signal: AbortSignal.timeout(7000) });
  assert.equal(denied.status, 403, 'Caddy must send signaling to the gate');
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  validateUrl.searchParams.set('vr_gate_credential', gateCredential);
  assert.equal((await fetch(validateUrl, { signal: AbortSignal.timeout(7000) })).status, 200);

  signalUrl.pathname = '/rtc';
  signalUrl.searchParams.set('access_token', admission.token);
  signalUrl.searchParams.set('protocol', '15');
  const signal = new WebSocket(signalUrl, { handshakeTimeout: 7000 });
  t.after(() => signal.terminate());
  await once(signal, 'open');
  signal.close();

  send(socket, 'room.leave', guest);
  await until(async () => (await request(statusPath)).status === 404, 'The empty Meet room did not expire');
  assert.equal(databaseSnapshot(), '0|0|0|0|0|0|0|0');
  const logs = compose('logs', '--no-color');
  for (const value of [guest.name, guest.sessionToken, ownerToken, rotated, grant, admission.token, gateCredential]) {
    assert.ok(!logs.includes(value), 'Personal stack logs exposed a name or credential');
  }
});
