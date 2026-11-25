import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { LiveKitAdmission } from '@voiceroom/shared/contracts/admission';
import { MeetOwnerAuthorization, MeetRoomCreated, MeetRoomStatus } from '@voiceroom/shared/contracts/rooms';
import { TokenVerifier } from 'livekit-server-sdk';
import { createOwnerCapability } from '../src/domains/rooms/meet-owner.service.ts';
import { codeOf } from '../src/platform/error-code.ts';
import { bootstrapPersonal } from '../src/server.personal.ts';
import { createTestDatabase } from './db-harness.ts';
import { recordingLogger } from './fakes/index.ts';
import { request, socketDir, startServer, waitForHealthz, type ServerLogs } from './fakes/server-process.ts';
import { countWsType, joinVoiceRoom, openWs, sendRawWs, sendWs, waitForClose, waitForWsType } from './ws-harness.ts';

const origin = 'https://meet.example.test';
const livekitKey = 'meet-test-key';
const livekitSecret = 'meet-test-livekit-server-secret';

async function until(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 7000;
  do {
    if (await check()) return;
    await delay(30);
  } while (Date.now() < deadline);
  assert.fail(message);
}

test('personal bootstrap refuses to listen and releases its connection if startup reconciliation fails', async (t) => {
  const db = await createTestDatabase(t, { empty: true });
  t.after(db.cleanup);
  const logger = recordingLogger();
  const exits: Array<number | undefined> = [];
  const server = await bootstrapPersonal({
    env: { DATABASE_URL: db.databaseUrl, MIGRATE_ON_START: 'false', PERSONAL_ORIGIN: origin, PORT: '0' },
    logger,
    exit: (code) => exits.push(code)
  });
  assert.equal(server, null);
  assert.deepEqual(exits, [1]);
  assert.equal(codeOf(logger.records.find((record) => record.evt === 'boot.failed')?.err), '42P01');
  await until(async () => {
    const { rowCount } = await db.pool.query(
      'SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()'
    );
    return rowCount === 0;
  }, 'Failed startup kept its database connection');
});

test('personal process keeps call and chat state transient and purges it on expiry and an unclean restart', async (t) => {
  const database = await createTestDatabase(t, { empty: true });
  const { dir, socketPath } = socketDir('voice-personal-');
  const ownerFile = path.join(dir, 'secret');
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const env = {
    LOG_LEVEL: 'debug',
    PERSONAL_ORIGIN: origin,
    PERSONAL_OWNER_FILE: ownerFile,
    MIGRATE_ON_START: 'true',
    ROOM_IDLE_TTL_MS: '1000',
    ROOM_PRUNE_INTERVAL_MS: '50',
    LIVEKIT_ROSTER_WAIT_MS: '30',
    LIVEKIT_INTERNAL_URL: 'ws://127.0.0.1:7880',
    LIVEKIT_GATE_PUBLIC_URL: 'wss://meet.example.test',
    LIVEKIT_GATE_SECRET: 'meet-test-gate-secret-at-least-32-bytes',
    LIVEKIT_API_KEY: livekitKey,
    LIVEKIT_API_SECRET: livekitSecret,
    WIDGET_ENABLED: 'true',
    MESSAGE_DELIVERY_LISTEN_ENABLED: 'true'
  };
  let processHandle = startServer(socketPath, database.databaseUrl, logs, env, 'src/server.personal.ts');
  async function kill() {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
    const closed = new Promise<void>((resolve, reject) => {
      processHandle.once('close', () => resolve());
      processHandle.once('error', reject);
    });
    processHandle.kill('SIGKILL');
    await closed;
  }
  t.after(async () => {
    await kill();
    await fs.rm(dir, { recursive: true, force: true });
    await database.cleanup();
  });
  await waitForHealthz(socketPath);
  assert.equal((await request(socketPath, { pathname: '/api/readyz' })).status, 200);

  const sensitiveValues: string[] = [];
  const assertLogsPrivate = () => {
    assert.match(logs.stdout, /boot\.listening/);
    const allLogs = logs.stdout + logs.stderr;
    for (const value of sensitiveValues) assert.ok(!allLogs.includes(value), 'Logs retained a private value');
  };

  async function operationalCounts() {
    const { rows } = await database.pool.query<{ rooms: number; peers: number; credentials: number; epochs: number }>(`
      SELECT (SELECT count(*)::int FROM rooms) AS rooms,
             (SELECT count(*)::int FROM room_peer_identities) AS peers,
             (SELECT count(*)::int FROM livekit_gate_credentials) AS credentials,
             (SELECT count(*)::int FROM livekit_gate_principal_epochs) AS epochs
    `);
    return rows[0];
  }
  async function assertNoFullSideEffects() {
    const { rows } = await database.pool.query<{ forbidden: number }>(`
      SELECT (
        (SELECT count(*) FROM voice_sessions) + (SELECT count(*) FROM voice_session_samples) +
        (SELECT count(*) FROM voice_call_events) + (SELECT count(*) FROM room_messages) +
        (SELECT count(*) FROM room_message_mentions) + (SELECT count(*) FROM message_delivery_outbox) +
        (SELECT count(*) FROM message_send_idempotency) + (SELECT count(*) FROM link_previews) +
        (SELECT count(*) FROM user_notifications) + (SELECT count(*) FROM push_subscriptions) +
        (SELECT count(*) FROM product_snapshots) + (SELECT count(*) FROM system_snapshots) +
        (SELECT count(*) FROM user_activity_days) + (SELECT count(*) FROM notification_outbox) +
        (SELECT count(*) FROM widget_runtime_owners WHERE owner_id IS NOT NULL) +
        (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND query ILIKE 'LISTEN %')
      )::int AS forbidden
    `);
    assert.equal(rows[0]?.forbidden, 0, 'Personal runtime created full-product side effects');
  }

  for (const [method, pathname] of [
    ['GET', '/api/auth/me'],
    ['GET', '/api/lobby'],
    ['GET', '/api/metrics'],
    ['GET', '/api/admin/health'],
    ['GET', '/api/widget/rooms'],
    ['POST', '/api/rooms'],
    ['POST', '/api/client-logs']
  ] as const) {
    assert.equal((await request(socketPath, { method, pathname })).status, 404, `${method} ${pathname}`);
  }
  const owner = createOwnerCapability(ownerFile);
  const link = await owner.printLink({ origin, rotate: false });
  assert.ok(link);
  const linkToken = new URLSearchParams(new URL(link).hash.slice(1)).get('owner');
  assert.ok(linkToken);
  sensitiveValues.push(linkToken);
  const exchange = { method: 'POST', pathname: '/api/meet/owner/exchange', body: { token: linkToken } };
  assert.equal((await request(socketPath, { ...exchange, headers: { Origin: 'https://other.test' } })).status, 403);
  const authorization = await request(socketPath, exchange, MeetOwnerAuthorization);
  assert.equal(authorization.status, 200);
  assert.deepEqual(authorization.setCookie, []);
  sensitiveValues.push(authorization.body.token);

  async function createRoom() {
    const { status, body } = await request(
      socketPath,
      { method: 'POST', pathname: '/api/meet/rooms', headers: { Authorization: `Bearer ${authorization.body.token}` } },
      MeetRoomCreated
    );
    assert.equal(status, 201);
    assert.equal(body.joinUrl, `${origin}/room/${body.roomId}`);
    return body.roomId;
  }

  async function connect(cookie?: string) {
    const guest = openWs(socketPath, { path: '/api/meet/ws', cookie });
    t.after(() => guest.ws.terminate());
    assert.deepEqual((await guest.ready).payload, { guest: true });
    return guest;
  }

  function newCall(roomId: string, name: string) {
    const call = { roomId, peerId: randomUUID(), sessionToken: randomUUID(), name };
    sensitiveValues.push(name, call.sessionToken);
    return call;
  }

  async function join(roomId: string, name: string) {
    const cookie = `vr_session=${randomUUID()}`;
    const guest = await connect(cookie);
    const call = newCall(roomId, name);
    const tokenRequest = { method: 'POST', pathname: '/api/meet/livekit-token', body: call, cookie };
    assert.equal((await request(socketPath, tokenRequest)).status, 409);
    const snapshot = await joinVoiceRoom(guest, call);
    assert.equal(snapshot.payload.peers[0]?.name, name);
    assert.deepEqual(snapshot.payload.recentMessages, []);
    sendWs(guest.ws, 'room.preview.subscribe', { roomId });
    assert.equal((await waitForWsType(guest.frames, 'error')).error.code, 'forbidden');

    const admission = await request(socketPath, tokenRequest, LiveKitAdmission);
    assert.equal(admission.status, 200);
    assert.equal(admission.body.capabilities?.chat, 'ephemeral');
    const claims = await new TokenVerifier(livekitKey, livekitSecret).verify(admission.body.token);
    assert.equal(claims.sub, call.peerId);
    assert.ok(!claims.name);
    assert.equal(claims.video?.canPublishData, false);
    const gateCredential = new URL(admission.body.url).searchParams.get('vr_gate_credential');
    assert.ok(gateCredential);
    sensitiveValues.push(admission.body.token, gateCredential);

    const { rows: identities } = await database.pool.query<{ display_name: string; session_token_hash: string }>(
      'SELECT display_name, session_token_hash FROM room_peer_identities WHERE room_id = $1',
      [roomId]
    );
    assert.deepEqual(identities, [
      { display_name: '', session_token_hash: createHash('sha256').update(call.sessionToken).digest('hex') }
    ]);
    const { rows: rooms } = await database.pool.query<{
      kind: string;
      is_static: boolean;
      owner_id: string | null;
      name: string;
      creator_ip: string;
      empty_since: Date | null;
    }>('SELECT kind, is_static, owner_id, name, creator_ip, empty_since FROM rooms WHERE id = $1', [roomId]);
    assert.deepEqual(rooms, [
      { kind: 'meet', is_static: false, owner_id: null, name: '', creator_ip: '', empty_since: null }
    ]);
    assert.deepEqual(await operationalCounts(), { rooms: 1, peers: 1, credentials: 1, epochs: 1 });
    await assertNoFullSideEffects();
    assertLogsPrivate();
    return { guest, call };
  }

  const first = await createRoom();
  const statusPath = `/api/meet/rooms/${first}/status`;
  const status = await request(socketPath, { pathname: statusPath }, MeetRoomStatus);
  assert.equal(status.body.peers, 0);
  assert.equal(status.body.capabilities?.chat, 'ephemeral');
  const { guest, call } = await join(first, 'Private Name After Leave');

  const visitor = await connect();
  const attempted = 'Private chat from an unattached visitor';
  sensitiveValues.push(attempted);
  sendWs(visitor.ws, 'meet.chat.send', { text: attempted });
  assert.equal((await waitForWsType(visitor.frames, 'error')).error.code, 'forbidden');
  sendRawWs(visitor.ws, { id: 'preview-attempt', type: 'room.preview.subscribe', payload: { roomId: first } });
  assert.equal(
    (await waitForWsType(visitor.frames, 'error', (frame) => frame.id === 'preview-attempt')).error.code,
    'forbidden'
  );

  const second = await connect();
  const secondCall = newCall(first, 'Private Chat Recipient');
  await joinVoiceRoom(second, secondCall);
  const other = await connect();
  const otherCall = newCall(await createRoom(), 'Private Guest in Another Room');
  await joinVoiceRoom(other, otherCall);

  const text = 'Private chat <b>hello</b> @example https://example.invalid/private-chat';
  sensitiveValues.push(text);
  // A forged target and author have no authority over chat routing or attribution.
  sendRawWs(guest.ws, {
    type: 'meet.chat.send',
    payload: { text: `  ${text}  `, roomId: otherCall.roomId, authorId: otherCall.peerId, displayName: otherCall.name }
  });
  const [echo, delivery] = await Promise.all([
    waitForWsType(guest.frames, 'meet.chat.message'),
    waitForWsType(second.frames, 'meet.chat.message')
  ]);
  assert.ok(delivery.payload.id);
  assert.deepEqual(delivery.payload, { id: delivery.payload.id, authorId: call.peerId, displayName: call.name, text });
  assert.deepEqual(echo.payload, delivery.payload);

  const closed = waitForClose(second.ws);
  second.ws.close(1000);
  assert.equal(await closed, 1000);
  const offline = 'Private chat sent while the recipient was away';
  sensitiveValues.push(offline);
  sendWs(guest.ws, 'meet.chat.send', { text: offline });
  await waitForWsType(guest.frames, 'meet.chat.message', (frame) => frame.payload.text === offline);

  const reconnected = await connect();
  const snapshot = await joinVoiceRoom(reconnected, secondCall);
  assert.deepEqual(snapshot.payload.recentMessages, []);
  assert.ok(snapshot.payload.peers.some((peer) => peer.id === secondCall.peerId));

  const live = 'Private chat sent after the recipient rejoined';
  sensitiveValues.push(live);
  sendWs(guest.ws, 'meet.chat.send', { text: live });
  await waitForWsType(reconnected.frames, 'meet.chat.message', (frame) => frame.payload.text === live);
  await Promise.all(
    [guest, reconnected, other, visitor].map(async ({ ws, frames }) => {
      sendWs(ws, 'ping', { at: 1 });
      await waitForWsType(frames, 'pong');
    })
  );
  assert.equal(countWsType(guest.frames, 'meet.chat.message'), 3);
  assert.equal(countWsType(second.frames, 'meet.chat.message'), 1);
  assert.equal(countWsType(reconnected.frames, 'meet.chat.message'), 1);
  assert.equal(countWsType(other.frames, 'meet.chat.message'), 0);
  assert.equal(countWsType(visitor.frames, 'meet.chat.message'), 0);
  assert.equal(countWsType(visitor.frames, 'room.snapshot'), 0);

  for (let i = 0; i < 5; i++) {
    const text = `Private chat consuming sender budget ${i}`;
    sensitiveValues.push(text);
    sendWs(guest.ws, 'meet.chat.send', { text });
    await waitForWsType(guest.frames, 'meet.chat.message', (frame) => frame.payload.text === text);
  }
  const senderClosed = waitForClose(guest.ws);
  guest.ws.close(1000);
  assert.equal(await senderClosed, 1000);
  const senderReconnected = await connect();
  await joinVoiceRoom(senderReconnected, call);
  const rateLimitedText = 'Private chat over budget after sender reconnect';
  sensitiveValues.push(rateLimitedText);
  sendWs(senderReconnected.ws, 'meet.chat.send', { text: rateLimitedText });
  assert.equal((await waitForWsType(senderReconnected.frames, 'error')).error.code, 'rate_limited');
  assert.equal(countWsType(senderReconnected.frames, 'meet.chat.message'), 0);
  await assertNoFullSideEffects();
  assertLogsPrivate();

  sendWs(other.ws, 'room.leave', otherCall);
  sendWs(reconnected.ws, 'room.leave', secondCall);
  sendWs(senderReconnected.ws, 'room.leave', call);
  await until(async () => {
    const firstStatus = await request(socketPath, { pathname: statusPath });
    const otherStatus = await request(socketPath, { pathname: `/api/meet/rooms/${otherCall.roomId}/status` });
    return firstStatus.status === 404 && otherStatus.status === 404;
  }, 'Idle calls did not close');
  const empty = { rooms: 0, peers: 0, credentials: 0, epochs: 0 };
  assert.deepEqual(await operationalCounts(), empty);
  await assertNoFullSideEffects();
  assertLogsPrivate();

  const unused = await createRoom();
  await until(
    async () => (await request(socketPath, { pathname: `/api/meet/rooms/${unused}/status` })).status === 404,
    'Never-joined Meet room did not expire'
  );
  assert.deepEqual(await operationalCounts(), empty);

  const abandoned = await createRoom();
  await join(abandoned, 'Private Name Across Restart');
  await kill();
  assert.deepEqual(await operationalCounts(), { rooms: 1, peers: 1, credentials: 1, epochs: 1 });
  // A new IPC address avoids the stale Unix socket left by killing the process.
  const restarted = socketDir('voice-personal-restart-');
  t.after(() => fs.rm(restarted.dir, { recursive: true, force: true }));
  processHandle = startServer(restarted.socketPath, database.databaseUrl, logs, env, 'src/server.personal.ts');
  await waitForHealthz(restarted.socketPath);
  assert.equal((await request(restarted.socketPath, { pathname: `/api/meet/rooms/${abandoned}/status` })).status, 404);
  assert.equal((await request(restarted.socketPath, exchange)).status, 401);
  assert.deepEqual(await operationalCounts(), empty);
  await assertNoFullSideEffects();
  assertLogsPrivate();
});
