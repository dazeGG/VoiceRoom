import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { json } from 'node:stream/consumers';
import test, { type TestContext } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { AccessToken, TokenVerifier } from 'livekit-server-sdk';
import WebSocket, { WebSocketServer } from 'ws';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { SignedIn } from '@voiceroom/shared/contracts/account';
import {
  LiveKitAdmission,
  NativeVoiceAdmission,
  NativeVoiceGeneration,
  type NativeVoiceAdmissionBody
} from '@voiceroom/shared/contracts/admission';
import { RoomSnapshot } from '@voiceroom/shared/contracts/realtime';
import { isRecord } from '@voiceroom/shared/guards';
import { createApiRuntime } from '../src/app/api-runtime.ts';
import { createLiveKitAuthGateService } from '../src/domains/admission/livekit-auth-gate.service.ts';
import { extractAccessToken } from '../src/domains/admission/livekit-token-binding.mts';
import { createDbPool } from '../src/platform/db/pool.ts';
import { createTestDatabase } from './db-harness.ts';
import { cookieFrom } from './fakes/server-process.ts';
import { checked } from './helpers/checked.ts';
import { joinVoiceRoom, openWs, sendRawWs, sendWs, waitForClose, waitForWsType } from './ws-harness.ts';

const SECRET = 'native-voice-test-gate-secret-at-least-32-bytes';
const API_KEY = 'native-voice-test-key';
const API_SECRET = 'native-voice-test-sfu-secret-at-least-32-bytes';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/139.0.0.0 Electron/39.0.0';
const TARGET = { roomId: 'native-main', peerId: 'native-peer', sessionToken: 's'.repeat(32) };
const OTHER_ROOM = 'native-other-room';
const ALIAS = /^native-peer#voice\.[0-9a-f]{32}$/;

async function listen(server: http.Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function close(server: http.Server) {
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function until(predicate: () => boolean | Promise<boolean>, message: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, message);
    await setTimeout(25);
  }
}

// The real auth gate talks to this signaling and Twirp boundary over TCP.
// The fake SFU verifies SDK JWT signatures and exposes exact removals.
async function startSfu() {
  const verifier = new TokenVerifier(API_KEY, API_SECRET);
  const removed: string[] = [];
  const attempts: { identity: string; at: number; source: 'api' | 'gate' }[] = [];
  // Media membership survives a signal socket closing until RoomService removes it.
  const participants = new Map<string, string>();
  const faults: {
    remove?: (identity: string, response: http.ServerResponse, source: 'api' | 'gate') => Promise<boolean>;
    get?: (identity: string) => Promise<void>;
  } = {};
  const tunnels = new WebSocketServer({ noServer: true });
  const claims = async (req: http.IncomingMessage) => {
    const token = extractAccessToken(req.url, req.headers);
    if (!token.ok || req.url?.includes('vr_gate_credential')) return null;
    return verifier.verify(token.token).catch(() => null);
  };
  function absent(res: http.ServerResponse) {
    res
      .writeHead(404, { 'content-type': 'application/json' })
      .end('{"code":"not_found","msg":"participant does not exist"}');
  }
  const serve = (source: 'api' | 'gate') => (req: http.IncomingMessage, res: http.ServerResponse) => {
    void (async () => {
      if (req.method === 'POST' && req.url?.endsWith('/ListRooms')) {
        const rooms = [...new Set(participants.values())].map((name) => ({ name }));
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ rooms }));
      } else if (req.method === 'POST' && req.url?.endsWith('/ListParticipants')) {
        const input = await json(req);
        assert.ok(isRecord(input) && typeof input.room === 'string');
        const members = [...participants].flatMap(([identity, room]) => (room === input.room ? [{ identity }] : []));
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ participants: members }));
      } else if (req.method === 'POST' && req.url?.endsWith('/RemoveParticipant')) {
        const input = await json(req);
        assert.ok(isRecord(input) && typeof input.identity === 'string');
        const { identity } = input;
        attempts.push({ identity, at: Date.now(), source });
        if (await faults.remove?.(identity, res, source)) return;
        removed.push(identity);
        const present = participants.delete(identity);
        if (!res.destroyed) {
          if (present) res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
          else absent(res);
        }
      } else if (req.method === 'POST' && req.url?.endsWith('/GetParticipant')) {
        const input = await json(req);
        assert.ok(isRecord(input) && typeof input.identity === 'string');
        await faults.get?.(input.identity);
        if (participants.has(input.identity)) {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(input));
        } else absent(res);
      } else {
        res.writeHead((await claims(req)) ? 200 : 403).end();
      }
    })().catch(() => res.writeHead(500).end());
  };
  const server = http.createServer(serve('gate'));
  const adminServer = http.createServer(serve('api'));
  server.on('upgrade', (req, socket, head) => {
    void claims(req)
      .then((grant) => {
        if (grant?.sub && grant.video?.room) {
          const { sub } = grant;
          const { room } = grant.video;
          tunnels.handleUpgrade(req, socket, head, () => participants.set(sub, room));
        } else socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      })
      .catch(() => socket.destroy());
  });
  const port = await listen(server);
  const adminPort = await listen(adminServer);
  return {
    verifier,
    removed,
    attempts,
    participants,
    faults,
    port,
    adminPort,
    async stop() {
      for (const tunnel of tunnels.clients) tunnel.terminate();
      tunnels.close();
      await close(server);
      await close(adminServer);
    }
  };
}

async function harness(t: TestContext) {
  const database = await createTestDatabase(t);
  const sfu = await startSfu();
  const createGate = (pool = database.pool) =>
    createLiveKitAuthGateService({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      pool,
      secret: SECRET,
      superviseWidgets: false,
      upstreamUrl: `ws://127.0.0.1:${sfu.port}`
    });
  let gate = createGate();
  let gateServer = gate.createServer();
  const gatePort = await listen(gateServer);
  const env = {
    NATIVE_VOICE_STAGE: 'internal-join',
    NATIVE_VOICE_ACCOUNT_IDS: '',
    NATIVE_VOICE_MAX_COMPANIONS_PER_ROOM: '1',
    MAX_ROOM_PEERS: '2',
    MAX_VOICE_PEERS: '2',
    AUTH_RATE_LIMIT: '0',
    LIVEKIT_GATE_SECRET: SECRET,
    LIVEKIT_GATE_PUBLIC_URL: `ws://127.0.0.1:${gatePort}`,
    LIVEKIT_INTERNAL_URL: `ws://127.0.0.1:${sfu.adminPort}`,
    LIVEKIT_API_KEY: API_KEY,
    LIVEKIT_API_SECRET: API_SECRET
  };
  const runtime = createApiRuntime({ env });
  runtime.services.connect({ databaseUrl: database.databaseUrl });
  const app = runtime.createApp();
  const sockets = new Set<WebSocket>();
  let apiDatabaseClosed: Promise<void> | undefined;
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await app.close();
    await apiDatabaseClosed;
    await runtime.closeStores();
    await gate.stop();
    await close(gateServer);
    await sfu.stop();
    await database.cleanup();
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const apiPort = address.port;

  const post = (url: string, payload: object, cookie?: string) =>
    app.inject({
      method: 'POST',
      url,
      payload,
      headers: { 'user-agent': WINDOWS, ...(cookie && { cookie }) }
    });
  async function signIn(login: string, action = 'register') {
    const response = await post(`/api/auth/${action}`, {
      login,
      password: 'native-voice-password',
      passwordConfirm: 'native-voice-password'
    });
    assert.equal(response.statusCode, action === 'register' ? 201 : 200, response.body);
    const user = checked(SignedIn, response.json<unknown>(), 'auth').user;
    return { cookie: cookieFrom(response.headers['set-cookie']), accountId: user.id };
  }
  const account = await signIn('native-user');
  const owner = await signIn('native-owner');
  env.NATIVE_VOICE_ACCOUNT_IDS = account.accountId;
  await database.pool.query(
    "INSERT INTO rooms(id,kind,is_static,owner_id) VALUES ($1,'main',true,$3),($2,'main',true,$3)",
    [TARGET.roomId, OTHER_ROOM, owner.accountId]
  );
  await database.pool.query("INSERT INTO rooms(id,kind) VALUES ('native-meet','meet')");

  async function socket(cookie?: string) {
    const session = openWs(apiPort, { cookie, headers: { 'User-Agent': WINDOWS } });
    sockets.add(session.ws);
    await session.ready;
    return session;
  }

  async function join(cookie = account.cookie, target = TARGET, supportsReceive = true) {
    const session = await socket(cookie);
    const snapshot = await joinVoiceRoom(session, {
      ...target,
      name: 'Native Peer',
      ...(supportsReceive && { nativeVoiceReceive: true })
    });
    const capability = snapshot.payload.nativeVoice;
    assert.ok(capability);
    const body = { ...target, version: 1, generation: capability.generation } as const;
    return { session, snapshot: snapshot.payload, body, capability };
  }

  const admit = (body: NativeVoiceAdmissionBody, cookie: string | null = account.cookie) =>
    post('/api/native-voice/admission', body, cookie ?? undefined);
  async function issue(body: NativeVoiceAdmissionBody) {
    const reply = await admit(body);
    assert.equal(reply.statusCode, 200, reply.body);
    return checked(NativeVoiceAdmission, reply.json<unknown>(), 'companion admission');
  }

  async function upgrade(admission: NativeVoiceAdmission) {
    const url = new URL(admission.url);
    url.pathname = '/rtc/v1';
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${admission.token}` } });
    sockets.add(ws);
    await once(ws, 'open');
    return ws;
  }

  return {
    database,
    env,
    sfu,
    account,
    owner,
    post,
    signIn,
    socket,
    join,
    admit,
    issue,
    upgrade,
    async restartGate(pool = database.pool) {
      await gate.stop();
      await close(gateServer);
      gate = createGate(pool);
      gateServer = gate.createServer();
      return listen(gateServer);
    },
    failApiDatabase() {
      // The registry drops its pool immediately. Its widget owner releases the
      // dedicated connection on app.close(), so defer waiting for pool.end().
      apiDatabaseClosed = runtime.services.close({ error() {} });
    }
  };
}

async function validate(admission: { url: string; token: string }, path = '/rtc/validate', bearer = false) {
  const url = new URL(admission.url);
  url.protocol = 'http:';
  url.pathname = path;
  if (!bearer) url.searchParams.set('access_token', admission.token);
  return (await fetch(url, { headers: bearer ? { Authorization: `Bearer ${admission.token}` } : {} })).status;
}

const skip = !process.env.TEST_DATABASE_URL;

test(
  'receive rollout keeps active snapshots readable by a P0 renderer that did not announce support',
  { skip },
  async (t) => {
    const h = await harness(t);
    h.env.NATIVE_VOICE_STAGE = 'receive';
    const p0 = await h.join(h.account.cookie, TARGET, false);
    const p0Snapshot = Type.Object({
      ...RoomSnapshot.properties,
      nativeVoice: Type.Optional(
        Type.Object({
          version: Type.Literal(1),
          stage: Type.Union([Type.Literal('off'), Type.Literal('internal-join')]),
          generation: NativeVoiceGeneration
        })
      )
    });
    assert.ok(Value.Check(p0Snapshot, p0.snapshot));
    assert.equal(p0.capability.stage, 'internal-join');
    const p1 = await h.join();
    assert.equal(p1.capability.stage, 'receive');
    assert.equal(Value.Check(p0Snapshot, p1.snapshot), false);
  }
);

test(
  'P0 admission is limited to the allowlisted Windows desktop voice generation and both session credentials',
  { skip },
  async (t) => {
    const h = await harness(t);
    const noSeat = { ...TARGET, version: 1, generation: '0'.repeat(32) } as const;
    assert.equal((await h.admit(noSeat, null)).statusCode, 401);
    assert.equal((await h.admit(noSeat)).statusCode, 409);
    const guest = await h.socket();
    const guestTarget = { ...TARGET, peerId: 'native-guest' };
    const guestSnapshot = await joinVoiceRoom(guest, { ...guestTarget, name: 'Guest' });
    assert.equal(guestSnapshot.payload.nativeVoice, undefined);
    assert.equal((await h.admit({ ...noSeat, ...guestTarget }, null)).statusCode, 401);
    assert.equal((await h.admit({ ...noSeat, ...guestTarget })).statusCode, 409);
    assert.equal((await h.admit({ ...noSeat, roomId: 'native-meet' })).statusCode, 404);

    const { session, body, capability } = await h.join();
    assert.equal(capability.stage, 'internal-join');
    const otherSession = await h.signIn('native-user', 'login');
    assert.equal((await h.admit(body, otherSession.cookie)).statusCode, 409);
    assert.equal((await h.admit({ ...body, sessionToken: 'x'.repeat(32) })).statusCode, 409);
    assert.equal((await h.admit({ ...body, generation: '0'.repeat(32) })).statusCode, 409);
    h.env.NATIVE_VOICE_STAGE = 'off';
    assert.equal((await h.admit(body)).json<{ code: string }>().code, 'native_voice_off');
    h.env.NATIVE_VOICE_STAGE = 'internal-join';
    h.env.NATIVE_VOICE_ACCOUNT_IDS = h.owner.accountId;
    assert.equal((await h.admit(body)).json<{ code: string }>().code, 'native_voice_ineligible');
    h.env.NATIVE_VOICE_ACCOUNT_IDS = h.account.accountId;

    for (const peerId of ['native-peer#voice', 'native-peer#voice.' + 'a'.repeat(32), 'native-peer#other']) {
      const response = await h.post('/api/livekit-token', { ...TARGET, peerId }, h.account.cookie);
      assert.equal(response.statusCode, 400);
      const since = session.frames.length;
      sendRawWs(session.ws, { type: 'room.join', id: peerId, payload: { ...TARGET, peerId, name: 'Forged' } });
      await waitForWsType(session.frames, 'error', (frame) => frame.error.code === 'invalid_peer_id', 5_000, since);
    }
    const replacement = await h.join();
    assert.notEqual(replacement.body.generation, body.generation);
    assert.equal((await h.admit(body)).statusCode, 409);
    assert.match((await h.issue(replacement.body)).identity, ALIAS);
  }
);

test('receive-stage leases use the exact JWT pair and subscribe-only grants', { skip }, async (t) => {
  const h = await harness(t);
  h.env.NATIVE_VOICE_STAGE = 'receive';
  const { session, body, capability } = await h.join();
  assert.equal(capability.stage, 'receive');
  const canonicalReply = await h.post('/api/livekit-token', { ...TARGET, name: 'Native Peer' }, h.account.cookie);
  assert.equal(canonicalReply.statusCode, 200, canonicalReply.body);
  const canonical = checked(LiveKitAdmission, canonicalReply.json<unknown>(), 'canonical admission');
  const [first, second] = await Promise.all([h.admit(body), h.admit(body)]);
  assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 409]);
  const admission = checked(
    NativeVoiceAdmission,
    (first.statusCode === 200 ? first : second).json<unknown>(),
    'admission'
  );
  assert.match(admission.identity, ALIAS);
  const { identity } = admission;
  assert.equal(admission.generation, body.generation);
  assert.ok(admission.ttlSeconds > 0 && admission.ttlSeconds <= 60);
  const parsed = await h.sfu.verifier.verify(admission.token);
  assert.equal(parsed.video?.canPublish, false);
  assert.equal(parsed.video?.canPublishData, false);
  assert.equal(parsed.video?.canSubscribe, true);
  assert.equal(parsed.video?.hidden, true, 'LiveKit omits the companion from legacy participant lists and updates');
  assert.equal(parsed.sub, identity);
  assert.equal(identity, `${TARGET.peerId}#voice.${parsed.attributes?.vr_native_voice_lease?.replaceAll('-', '')}`);
  assert.equal(await validate(admission), 200);
  assert.equal(await validate(admission, '/rtc/v1/validate', true), 200);
  assert.equal(await validate({ ...admission, token: canonical.token }), 403);
  assert.equal(await validate({ ...canonical, token: admission.token }), 403);
  for (const [forgedIdentity, grant, attributes] of [
    ['native-peer#other', parsed.video, parsed.attributes],
    [identity, { ...parsed.video, canPublish: true }, parsed.attributes],
    [identity, { ...parsed.video, hidden: false }, parsed.attributes],
    [identity, parsed.video, { vr_native_voice_lease: 'another-issuance' }]
  ] as const) {
    const forged = new AccessToken(API_KEY, API_SECRET, {
      identity: forgedIdentity,
      ...(attributes && { attributes })
    });
    forged.addGrant({ ...grant, room: admission.room, roomJoin: true });
    assert.equal(await validate({ ...admission, token: await forged.toJwt() }), 403);
  }
  const refresh = new AccessToken(API_KEY, API_SECRET, {
    identity,
    ...(parsed.attributes && { attributes: parsed.attributes })
  });
  refresh.addGrant({ ...parsed.video, room: admission.room, roomJoin: true });
  assert.equal(await validate({ ...admission, token: await refresh.toJwt() }), 200);
  const companion = await h.upgrade(admission);
  const mapping = await waitForWsType(session.frames, 'room.companions.updated');
  assert.deepEqual(mapping.payload.companions, [{ identity, peerId: TARGET.peerId }]);
  const otherTarget = { ...TARGET, peerId: 'native-other', sessionToken: 'o'.repeat(32) };
  const other = await h.join(h.account.cookie, otherTarget);
  assert.equal(other.capability.stage, 'receive');
  assert.equal(other.snapshot.peers.length, 2, 'a companion leaves a canonical room and voice seat free');
  assert.deepEqual(other.snapshot.nativeVoiceCompanions?.companions, mapping.payload.companions);
  const overCapacity = await h.admit(other.body);
  assert.equal(overCapacity.statusCode, 409);
  assert.equal(overCapacity.json<{ code: string }>().code, 'native_voice_capacity', overCapacity.body);

  const closed = waitForClose(companion);
  h.env.NATIVE_VOICE_STAGE = 'off';
  await closed;
  await until(() => h.sfu.removed.includes(identity), 'switch-off removes the SFU participant');
  assert.equal(await validate(admission), 403);
  assert.equal(await validate(canonical), 200, 'retirement revokes only the companion credential');
  const cleared = await waitForWsType(
    session.frames,
    'room.companions.updated',
    (frame) => frame.payload.companions.length === 0
  );
  assert.deepEqual(cleared.payload.companions, []);
  h.env.NATIVE_VOICE_STAGE = 'internal-join';
  assert.equal((await h.admit(body)).statusCode, 409, 'the retiring participant still occupies a slot');
  await until(
    async () => {
      const { rowCount } = await h.database.pool.query('SELECT id FROM native_voice_leases WHERE room_id = $1', [
        TARGET.roomId
      ]);
      return rowCount === 0;
    },
    'the slot is released after final SFU removal',
    12_000
  );
  const next = await h.issue(body);
  assert.notEqual(next.identity, identity);
  assert.equal(await validate(next), 200);
  assert.equal(await validate({ ...next, token: admission.token }), 403);
  assert.equal(await validate({ ...admission, token: next.token }), 403);
});

for (const action of ['leave', 'kick', 'ban', 'expiry', 'heartbeat', 'replacement', 'disconnect'] as const) {
  test(
    `${action} cuts the active companion tunnel, revokes its credential and removes it at the SFU`,
    { skip },
    async (t) => {
      const h = await harness(t);
      const { session, body } = await h.join();
      const admission = await h.issue(body);
      const companion = await h.upgrade(admission);
      const closed = waitForClose(companion);
      if (action === 'leave') sendWs(session.ws, 'room.leave', TARGET);
      else if (action === 'kick' || action === 'ban') {
        const result = await h.post(`/api/rooms/${TARGET.roomId}/${action}`, { peerId: TARGET.peerId }, h.owner.cookie);
        assert.equal(result.statusCode, action === 'kick' ? 200 : 201, result.body);
      } else if (action === 'expiry') {
        await h.database.pool.query("UPDATE native_voice_leases SET expires_at=now() - interval '1 second'");
      } else if (action === 'heartbeat') {
        await h.database.pool.query("UPDATE native_voice_leases SET valid_until=now() - interval '1 second'");
      } else if (action === 'replacement') {
        const replacement = await h.join();
        assert.notEqual(replacement.body.generation, body.generation);
      } else {
        session.ws.terminate();
      }
      await closed;
      await until(() => h.sfu.removed.includes(admission.identity), `${action} removes the SFU companion`);
      assert.equal(await validate(admission, '/rtc/v1/validate', true), 403);
      await until(async () => {
        const { rows } = await h.database.pool.query<{ revoked_at: Date | null }>(
          'SELECT revoked_at FROM livekit_gate_credentials WHERE room_id=$1 AND peer_id=$2',
          [TARGET.roomId, admission.identity]
        );
        return Boolean(rows[0]?.revoked_at);
      }, 'the API independently revokes the durable credential');
    }
  );
}

test(
  'the gate cuts off media and retries RoomService with both API and gate database paths down',
  { skip },
  async (t) => {
    const h = await harness(t);
    const { body } = await h.join();
    const admission = await h.issue(body);
    const { identity } = admission;
    const companion = await h.upgrade(admission);
    const closed = waitForClose(companion);
    companion.terminate();
    await closed;
    assert.ok(h.sfu.participants.has(identity), 'closing signaling leaves media membership on the SFU');

    h.sfu.faults.remove = async (target, res) => {
      if (target !== identity || h.sfu.attempts.length !== 1) return false;
      res.writeHead(502).end();
      return true;
    };
    h.failApiDatabase();
    const { rows } = await h.database.pool.query<{ valid_until: Date }>(
      'SELECT valid_until FROM native_voice_leases WHERE room_id = $1',
      [TARGET.roomId]
    );
    const heartbeatDeadline = rows[0]?.valid_until.getTime();
    assert.ok(heartbeatDeadline);
    await h.database.pool.end();

    await until(() => h.sfu.attempts.length > 0, 'the gate starts removal at the cached heartbeat deadline', 7_000);
    const first = h.sfu.attempts[0];
    assert.equal(first?.identity, identity);
    assert.ok(first.at <= heartbeatDeadline + 1_500);
    assert.ok(h.sfu.participants.has(identity), 'the first administration request failed');
    await until(() => !h.sfu.participants.has(identity), 'the gate retries and removes the participant', 5_000);
    const retry = h.sfu.attempts[1];
    assert.equal(retry?.identity, identity);
    assert.ok(retry.at - first.at >= 740, 'retry applies jittered backoff');
    assert.ok(retry.at <= heartbeatDeadline + 9_000);
  }
);

test('a replacement gate removes unverifiable companions with PostgreSQL unavailable', { skip }, async (t) => {
  const h = await harness(t);
  const { body } = await h.join();
  const admission = await h.issue(body);
  const companion = await h.upgrade(admission);
  const closed = waitForClose(companion);
  await until(() => h.sfu.participants.has(admission.identity), 'the companion joined the SFU');
  h.sfu.participants.set('ordinary-peer', admission.room);
  h.sfu.participants.set('foreign-peer#voice.opaque', 'foreign-room');
  h.failApiDatabase();
  await h.database.pool.end();

  const connections = new Set<net.Socket>();
  // Keep the TCP connection open without completing the PostgreSQL handshake.
  const unreachableDb = net.createServer((connection) => {
    connections.add(connection);
    connection.on('close', () => connections.delete(connection));
  });
  unreachableDb.listen(0, '127.0.0.1');
  await once(unreachableDb, 'listening');
  const address = unreachableDb.address();
  assert.ok(address && typeof address !== 'string');
  const databaseUrl = new URL(h.database.databaseUrl);
  databaseUrl.port = String(address.port);
  const pool = createDbPool({ databaseUrl: databaseUrl.href, logger: { error() {} } });
  t.after(async () => {
    const closed = new Promise<void>((resolve) => unreachableDb.close(() => resolve()));
    for (const connection of connections) connection.destroy();
    await pool.end();
    await closed;
  });
  const restartedAt = Date.now();
  await h.restartGate(pool);
  await closed;
  await until(() => !h.sfu.participants.has(admission.identity), 'the restarted gate removes the companion', 10_000);
  assert.ok(Date.now() - restartedAt <= 10_000);
  assert.ok(connections.size > 0, 'the new gate tried to contact PostgreSQL');
  assert.deepEqual(
    h.sfu.attempts.map(({ source, identity }) => [source, identity]),
    [['gate', admission.identity]]
  );
  assert.ok(h.sfu.participants.has('ordinary-peer'));
  assert.ok(h.sfu.participants.has('foreign-peer#voice.opaque'));
});

test('a replacement gate keeps verified companions under the heartbeat watchdog', { skip }, async (t) => {
  const h = await harness(t);
  const { body } = await h.join();
  const admission = await h.issue(body);
  await h.upgrade(admission);
  const port = await h.restartGate();
  const metrics = async () => (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
  await until(
    async () => (await metrics()).includes('voice_room_livekit_gate_native_voice_watches 1'),
    'the gate watches the recovered lease'
  );
  assert.ok(h.sfu.participants.has(admission.identity));
  assert.deepEqual(h.sfu.attempts, []);
  h.failApiDatabase();
  await until(() => !h.sfu.participants.has(admission.identity), 'the recovered lease loses its heartbeat', 7_000);
});

test(
  'the API hands off retirement after one attempt and the gate recovers after a RoomService outage',
  { skip },
  async (t) => {
    const h = await harness(t);
    const { session, body } = await h.join();
    const admission = await h.issue(body);
    await h.upgrade(admission);
    let outage = true;
    h.sfu.faults.remove = async (_identity, response) => {
      if (outage) response.writeHead(502).end();
      return outage;
    };

    sendWs(session.ws, 'room.leave', TARGET);
    await until(
      () => {
        const attempts = h.sfu.attempts.filter(({ identity }) => identity === admission.identity);
        const first = attempts.find(({ source }) => source === 'api');
        return (
          first !== undefined &&
          Date.now() - first.at >= 10_000 &&
          attempts.filter(({ source }) => source === 'gate').length >= 4
        );
      },
      'the gate backs off across the sustained outage',
      15_000
    );
    const attempts = h.sfu.attempts.filter(({ identity }) => identity === admission.identity);
    assert.equal(attempts.filter(({ source }) => source === 'api').length, 1);
    assert.ok(h.sfu.participants.has(admission.identity));
    const replacement = await h.join();
    assert.equal((await h.admit(replacement.body)).json<{ code: string }>().code, 'native_voice_capacity');

    outage = false;
    await until(
      () => !h.sfu.participants.has(admission.identity),
      'the gate removes the companion after recovery',
      10_000
    );
    await until(
      async () => (await h.database.pool.query('SELECT id FROM native_voice_leases')).rowCount === 0,
      'the gate releases the slot after confirming absence',
      5_000
    );
    assert.equal(
      h.sfu.attempts.filter(({ identity, source }) => identity === admission.identity && source === 'api').length,
      1
    );
    assert.notEqual((await h.issue(replacement.body)).identity, admission.identity);
  }
);

test('an exhausted durable cleanup keeps its slot and is eligible on the next gate startup', { skip }, async (t) => {
  const h = await harness(t);
  const { body } = await h.join();
  const admission = await h.issue(body);
  h.sfu.participants.set(admission.identity, admission.room);
  h.sfu.faults.remove = async (_identity, response) => {
    response.writeHead(502).end();
    return true;
  };
  await h.database.pool.query("UPDATE native_voice_leases SET retired_at = now() - interval '3 minutes'");
  await until(async () => {
    const { rows } = await h.database.pool.query<{ cleanup_exhausted_at: Date | null }>(
      'SELECT cleanup_exhausted_at FROM native_voice_leases'
    );
    return Boolean(rows[0]?.cleanup_exhausted_at);
  }, 'the gate records that the final RoomService attempt failed');
  const url = new URL(admission.url);
  const metrics = await fetch(`http://${url.host}/metrics`).then((response) => response.text());
  assert.match(metrics, /voice_room_livekit_gate_native_voice_cleanup_exhausted_total 1\n/);
  assert.equal((await h.admit(body)).json<{ code: string }>().code, 'native_voice_capacity');
  assert.ok(h.sfu.participants.has(admission.identity));

  h.sfu.faults.remove = async () => false;
  await setTimeout(1_250);
  assert.deepEqual(
    h.sfu.attempts.map(({ source }) => source),
    ['gate']
  );
  await h.restartGate();
  await until(() => !h.sfu.participants.has(admission.identity), 'the restarted gate recovers the exhausted cleanup');
  await until(
    async () => (await h.database.pool.query('SELECT id FROM native_voice_leases')).rowCount === 0,
    'the gate releases the slot after confirming absence',
    12_000
  );
});

test('a delayed old removal cannot hit a replacement and a route 404 cannot release the slot', { skip }, async (t) => {
  const h = await harness(t);
  const { session, body } = await h.join();
  const previous = await h.issue(body);
  await h.upgrade(previous);
  const resume = Promise.withResolvers<void>();
  const timedOut = Promise.withResolvers<void>();
  let delayed = false;
  let misrouted = true;
  h.sfu.faults.remove = async (identity, res, source) => {
    if (identity !== previous.identity) return false;
    if (!delayed && source === 'api') {
      delayed = true;
      res.once('close', () => timedOut.resolve());
      await resume.promise;
      return false;
    }
    if (!misrouted) return false;
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"code":"not_found","msg":"route not found"}');
    return true;
  };

  try {
    sendWs(session.ws, 'room.leave', TARGET);
    await Promise.race([timedOut.promise, setTimeout(5_000, false)]).then((result) =>
      assert.notEqual(result, false, 'the client must time out before the server applies the request')
    );
    const replacement = await h.join();
    const { rows } = await h.database.pool.query<{ retired_at: Date }>(
      'SELECT retired_at FROM native_voice_leases WHERE room_id = $1',
      [TARGET.roomId]
    );
    const retiredAt = rows[0]?.retired_at.getTime();
    assert.ok(retiredAt);
    await until(
      () => h.sfu.attempts.some(({ at, source }) => source === 'gate' && at >= retiredAt + 7_000),
      'a removal after the drain received a route 404',
      13_000
    );
    await setTimeout(250);
    assert.equal((await h.admit(replacement.body)).json<{ code: string }>().code, 'native_voice_capacity');

    misrouted = false;
    await until(
      async () => (await h.database.pool.query('SELECT id FROM native_voice_leases')).rowCount === 0,
      'a genuine RoomService response releases the retired slot',
      10_000
    );
    const next = await h.issue(replacement.body);
    assert.notEqual(previous.identity, next.identity);
    await h.upgrade(next);
    const completed = h.sfu.removed.filter((identity) => identity === previous.identity).length;
    resume.resolve();
    await until(
      () => h.sfu.removed.filter((identity) => identity === previous.identity).length > completed,
      'the server applies the original timed-out removal'
    );
    assert.ok(h.sfu.participants.has(next.identity), 'the late removal leaves the replacement joined');
    assert.equal(await validate(next), 200);
  } finally {
    resume.resolve();
  }
});

test('a RoomService cleanup spanning a heartbeat window leaves the other room authorized', { skip }, async (t) => {
  const h = await harness(t);
  const first = await h.join();
  const retiring = await h.issue(first.body);
  await h.upgrade(retiring);
  const second = await h.join(h.account.cookie, { ...TARGET, roomId: OTHER_ROOM });
  const healthy = await h.issue(second.body);
  const connection = await h.upgrade(healthy);
  h.sfu.faults.remove = async (identity, response, source) => {
    if (identity !== retiring.identity) return false;
    await setTimeout(2_800);
    if (source === 'api') {
      response.writeHead(502).end();
      return true;
    }
    return false;
  };
  let checks = 0;
  h.sfu.faults.get = async (identity) => {
    if (identity === retiring.identity) {
      checks += 1;
      await setTimeout(2_800);
    }
  };

  sendWs(first.session.ws, 'room.leave', TARGET);
  await until(
    () => h.sfu.attempts.some(({ identity, source }) => retiring.identity === identity && source === 'gate'),
    'gate cleanup begins'
  );
  const start = h.sfu.attempts.find(({ identity, source }) => retiring.identity === identity && source === 'gate')?.at;
  assert.ok(start);
  do {
    assert.equal(await validate(healthy), 200);
    assert.equal(connection.readyState, WebSocket.OPEN);
    await setTimeout(100);
  } while (Date.now() - start < 5_300);
  assert.ok(checks > 0, 'the cleanup was waiting for the absence check');
  assert.equal(await validate(healthy), 200);
  assert.ok(h.sfu.participants.has(healthy.identity));
});
