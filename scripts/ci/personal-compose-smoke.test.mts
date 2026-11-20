import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { connect, type TLSSocket } from 'node:tls';
import { SignalResponse } from '@livekit/protocol';
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

const stunCookie = 0x2112a442;

function turnAttribute(type: number, value: Buffer | string): Buffer {
  const bytes = Buffer.from(value);
  const attribute = Buffer.alloc(4 + Math.ceil(bytes.length / 4) * 4);
  attribute.writeUInt16BE(type);
  attribute.writeUInt16BE(bytes.length, 2);
  bytes.copy(attribute, 4);
  return attribute;
}

// RFC 8656 Allocate with REQUESTED-TRANSPORT=UDP. The authenticated retry
// uses the RFC 8489 long-term credential from LiveKit signaling.
function allocateRequest(auth?: { username: string; realm: Buffer; nonce: Buffer; password: string }): Buffer {
  const header = Buffer.alloc(20);
  header.writeUInt16BE(0x0003);
  header.writeUInt32BE(stunCookie, 4);
  randomBytes(12).copy(header, 8);
  const transport = turnAttribute(0x0019, Buffer.from([17, 0, 0, 0]));
  header.writeUInt16BE(transport.length, 2);
  if (!auth) return Buffer.concat([header, transport]);

  const attributes = Buffer.concat([
    transport,
    turnAttribute(0x0006, auth.username),
    turnAttribute(0x0014, auth.realm),
    turnAttribute(0x0015, auth.nonce)
  ]);
  header.writeUInt16BE(attributes.length + 24, 2);
  const key = createHash('md5').update(`${auth.username}:${auth.realm.toString()}:${auth.password}`).digest();
  const body = Buffer.concat([header, attributes]);
  const integrity = createHmac('sha1', key).update(body).digest();
  return Buffer.concat([body, turnAttribute(0x0008, integrity)]);
}

function turnAttributes(response: Buffer, request: Buffer, type: number): Map<number, Buffer> {
  assert.equal(response.readUInt16BE(), type);
  assert.equal(response.readUInt32BE(4), stunCookie);
  assert.deepEqual(response.subarray(8, 20), request.subarray(8, 20));
  assert.equal(response.length, response.readUInt16BE(2) + 20);
  const attributes = new Map<number, Buffer>();
  for (let offset = 20; offset < response.length;) {
    const length = response.readUInt16BE(offset + 2);
    attributes.set(response.readUInt16BE(offset), response.subarray(offset + 4, offset + 4 + length));
    offset += 4 + Math.ceil(length / 4) * 4;
  }
  return attributes;
}

async function sendTurn(socket: TLSSocket, request: Buffer): Promise<Buffer> {
  socket.write(request);
  let response = Buffer.alloc(0);
  const chunks: AsyncIterable<unknown, unknown, unknown> = socket.iterator({ destroyOnReturn: false });
  for await (const chunk of chunks) {
    assert.ok(Buffer.isBuffer(chunk));
    response = Buffer.concat([response, chunk]);
    if (response.length >= 20 && response.length >= 20 + response.readUInt16BE(2)) return response;
  }
  return assert.fail('TURN closed the connection before replying');
}

async function verifyTurnRelay({
  urls,
  username,
  credential
}: {
  urls: string[];
  username: string;
  credential: string;
}): Promise<void> {
  const servername = `turn.${process.env.PERSONAL_DOMAIN ?? 'localhost'}`;
  const host = site.hostname;
  const udpPort = Number(process.env.PERSONAL_TURN_UDP_PORT ?? '3478');
  const relayFirst = Number(process.env.PERSONAL_RELAY_PORT_FIRST ?? '30000');
  const relayLast = Number(process.env.PERSONAL_RELAY_PORT_LAST ?? '30099');
  assert.ok(urls.includes(`turns:${servername}:443?transport=tcp`));
  assert.ok(urls.includes(`turn:${host}:${udpPort}?transport=udp`));
  assert.ok(username && credential, 'LiveKit supplies temporary TURN credentials');

  const udp = createSocket('udp4');
  try {
    const request = allocateRequest();
    const response: Promise<unknown[]> = once(udp, 'message', { signal: AbortSignal.timeout(7000) });
    udp.send(request, udpPort, host);
    const message = await response;
    const [reply] = message;
    assert.ok(Buffer.isBuffer(reply));
    const error = turnAttributes(reply, request, 0x0113).get(0x0009);
    assert.deepEqual(error?.subarray(2, 4), Buffer.from([4, 1]), 'TURN/UDP challenges the allocation');
  } finally {
    udp.close();
  }

  const ca = compose('exec', '-T', 'caddy', 'cat', '/data/caddy/pki/authorities/local/root.crt');
  const port = Number(process.env.PERSONAL_HTTPS_PORT ?? '443');
  const tls = connect({ host, port, servername, ca });
  tls.setTimeout(7000, () => tls.destroy(new Error('TURN/TLS timed out')));
  try {
    await once(tls, 'secureConnect');
    assert.ok(tls.authorized, 'SNI serves a certificate signed by Caddy for the TURN hostname');
    const request = allocateRequest();
    const challenge = turnAttributes(await sendTurn(tls, request), request, 0x0113);
    const realm = challenge.get(0x0014);
    const nonce = challenge.get(0x0015);
    assert.ok(realm && nonce, 'TURN/TLS challenges the allocation');

    const authenticated = allocateRequest({ username, realm, nonce, password: credential });
    const allocated = turnAttributes(await sendTurn(tls, authenticated), authenticated, 0x0103);
    const relayed = allocated.get(0x0016);
    assert.ok(relayed, 'TURN/TLS allocates a relayed address');
    const relayPort = relayed.readUInt16BE(2) ^ (stunCookie >>> 16);
    assert.ok(
      relayPort >= relayFirst && relayPort <= relayLast,
      `Relay port ${relayPort} is outside the published range`
    );
  } finally {
    tls.destroy();
  }
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
  assert.match(await page.text(), /<title>VoiceRoom Meet<\/title>/);
  const csp = page.headers.get('content-security-policy') ?? '';
  assert.match(csp, /(?:^|; )frame-ancestors 'none'(?:;|$)/);
  assert.ok(csp.split('; ').includes(`connect-src 'self' ws://${site.host} stun: turn: turns:`));
  assert.match(csp, /(?:^|; )script-src 'self' 'wasm-unsafe-eval'(?:;|$)/);
  assert.match(page.headers.get('permissions-policy') ?? '', /display-capture=\(self\)/);
  assert.equal(page.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(page.headers.get('access-control-allow-origin'), null);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  for (const [path, contentType] of [
    ['/rnnoise/rnnoise.mjs', /javascript/],
    ['/rnnoise/rnnoise.wasm', /^application\/wasm/],
    ['/rnnoise/rnnoise.worklet.js', /javascript/],
    ['/audio-gate.worklet.js', /javascript/],
    ['/desktop-audio-source.worklet.js', /javascript/]
  ] as const) {
    const asset = await request(`${path}?v=smoke`);
    assert.equal(asset.status, 200, path);
    assert.match(asset.headers.get('content-type') ?? '', contentType);
    assert.equal(asset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    await asset.arrayBuffer();
  }
  const unversionedWasm = await request('/rnnoise/rnnoise.wasm');
  assert.equal(unversionedWasm.headers.get('cache-control'), 'no-cache');
  await unversionedWasm.arrayBuffer();
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

test('owner, guest signaling and authenticated TURN work on a clean personal stack', async (t) => {
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
  const message: unknown[] = await once(signal, 'message', { signal: AbortSignal.timeout(7000) });
  const [frame] = message;
  assert.ok(Buffer.isBuffer(frame));
  const response = SignalResponse.fromBinary(frame).message;
  assert.equal(response.case, 'join');
  const turn = response.value.iceServers.find(({ urls }) => urls.some((url) => url.startsWith('turns:')));
  assert.ok(turn, 'LiveKit advertises TURN/TLS with the guest signaling response');
  await verifyTurnRelay(turn);
  signal.close();

  send(socket, 'room.leave', guest);
  await until(async () => (await request(statusPath)).status === 404, 'The empty Meet room did not expire');
  assert.equal(databaseSnapshot(), '0|0|0|0|0|0|0|0');
  const logs = compose('logs', '--no-color');
  for (const value of [guest.name, guest.sessionToken, ownerToken, rotated, grant, admission.token, gateCredential]) {
    assert.ok(!logs.includes(value), 'Personal stack logs exposed a name or credential');
  }
});
