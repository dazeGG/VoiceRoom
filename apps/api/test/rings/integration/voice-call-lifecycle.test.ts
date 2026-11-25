import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import test, { mock, type TestContext } from 'node:test';
import { Me } from '@voiceroom/shared/contracts/account';
import { LiveKitAdmission } from '@voiceroom/shared/contracts/admission';
import { DirectHistoryPage, DirectThread } from '@voiceroom/shared/contracts/messages';
import {
  CallAnswer,
  CallBootstrap,
  CallDetails,
  CallMissedSeenAnswer,
  CallNotificationTarget,
  RingAnswer,
  type CallActionBody
} from '@voiceroom/shared/contracts/rings';
import { createApiRuntime } from '../../../src/app/api-runtime.ts';
import { createLiveKitAuthGateService } from '../../../src/domains/admission/livekit-auth-gate.service.ts';
import { createCredentialBoundaryService } from '../../../src/domains/admission/credential-boundary.service.ts';
import { createGateCredentialRepository } from '../../../src/domains/admission/gate-credential.repository.ts';
import { updateCallMessage } from '../../../src/domains/messaging/call-history.repository.ts';
import { kyselyOn } from '../../../src/platform/db/kysely.ts';
import { createLogger } from '../../../src/lib/logger.ts';
import { LOG_EVENTS } from '../../../src/lib/log-events.ts';
import { createTestDatabase } from '../../db-harness.ts';
import {
  acceptFirstFriendRequest,
  registerAccount,
  request,
  sendFriendRequest,
  socketDir
} from '../../fakes/server-process.ts';
import { joinVoiceRoom, openWs, sendRawWs, waitForWsType, type WsSession } from '../../ws-harness.ts';

const basePath = '/api/call-rings';
const grace = 30_000;
const gateSecret = 'call-test-secret-for-credential-signing';

async function setup(t: TestContext, envOverrides: Record<string, string> = {}) {
  const { pool, databaseUrl, cleanup } = await createTestDatabase(t);
  const logger = createLogger({ name: 'api' });
  const env = {
    NODE_ENV: 'test',
    VOICE_CALLS_ENABLED: 'true',
    RING_RATE_LIMIT: '0',
    AUTH_RATE_LIMIT: '0',
    LIVEKIT_INTERNAL_URL: 'ws://localhost:7880',
    LIVEKIT_GATE_PUBLIC_URL: 'wss://gate.example.test',
    LIVEKIT_API_KEY: 'call-test-key',
    LIVEKIT_API_SECRET: 'call-test-livekit-key-secret',
    LIVEKIT_GATE_SECRET: gateSecret,
    ...envOverrides
  };
  const evicted: { roomId: string; peerId: string }[] = [];
  const logs: string[] = [];
  let fakeRemoveFailures = 0;
  let removalHold: { started: PromiseWithResolvers<void>; release: PromiseWithResolvers<void> } | null = null;
  let now = Date.now();
  let nextTimer = 0;
  const timers = new Map<number, { due: number; callback: () => void }>();
  const children: (() => Promise<void>)[] = [];
  t.after(async () => {
    for (const close of children.reverse()) await close();
    await cleanup();
  });
  const gate = createLiveKitAuthGateService({ pool, secret: gateSecret, superviseWidgets: false });
  async function boot(enabled = env.VOICE_CALLS_ENABLED) {
    const { dir, socketPath } = socketDir('call-lifecycle-');
    const sockets: WsSession[] = [];
    const runtime = createApiRuntime({
      env: { ...env, VOICE_CALLS_ENABLED: enabled },
      callLiveKitAdmin: {
        async removeCallParticipant(roomId, peerId) {
          if (removalHold) {
            removalHold.started.resolve();
            await removalHold.release.promise;
          }
          if (fakeRemoveFailures > 0) {
            fakeRemoveFailures -= 1;
            throw new Error('Temporary LiveKit admin failure');
          }
          evicted.push({ roomId, peerId });
        }
      }
    });
    runtime.services.connect({ databaseUrl, logger });
    const server = runtime.createServer({
      logger: createLogger({
        env: { LOG_LEVEL: 'info' },
        destination: { write: (line) => logs.push(line) }
      }),
      realtimeNow: () => now,
      realtimeReconnectLeaseMs: grace,
      realtimeSetTimeout(callback, delay) {
        const id = ++nextTimer;
        timers.set(id, { due: now + delay, callback });
        return id;
      },
      realtimeClearTimeout(timer) {
        if (typeof timer === 'number') timers.delete(timer);
      }
    });
    let stopped = false;
    const close = async () => {
      if (stopped) return;
      stopped = true;
      for (const socket of sockets) socket.ws.terminate();
      await server.app.close();
      timers.clear();
      await runtime.closeStores(logger);
      await fs.rm(dir, { force: true, recursive: true });
    };
    children.push(close);
    await new Promise<void>((resolve, reject) =>
      server.listen(socketPath, (error?: Error) => {
        if (error) reject(error);
        else resolve();
      })
    );
    return {
      close,
      socketPath,
      async socket(cookie: string) {
        const socket = openWs(socketPath, { cookie });
        sockets.push(socket);
        await socket.ready;
        return socket;
      },
      async account(login: string) {
        const cookie = await registerAccount(socketPath, login);
        const { user } = (await request(socketPath, { pathname: '/api/auth/me', cookie }, Me)).body;
        assert.ok(user);
        return { cookie, id: user.id, login };
      }
    };
  }
  function advance(ms: number) {
    now += ms;
    for (const [id, timer] of timers) {
      if (timer.due <= now) {
        timers.delete(id);
        timer.callback();
      }
    }
    return now;
  }
  return {
    pool,
    boot,
    evicted,
    logs,
    gate,
    advance,
    failRemoval: (attempts: number) => {
      fakeRemoveFailures = attempts;
    },
    holdRemoval() {
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      removalHold = { started, release };
      const unblock = () => {
        removalHold = null;
        release.resolve();
      };
      t.after(unblock);
      return { started: started.promise, unblock };
    }
  };
}

type Account = { id: string; cookie: string; login: string };
type Running = Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['boot']>>;

async function befriend(api: Running, a: Account, b: Account) {
  await sendFriendRequest(api.socketPath, a.cookie, b.login);
  await acceptFirstFriendRequest(api.socketPath, b.cookie);
}

async function start(api: Running, a: Account, b: Account, clientRequestId = randomUUID()) {
  return (
    await request(
      api.socketPath,
      {
        method: 'POST',
        pathname: basePath,
        cookie: a.cookie,
        body: { peerUserId: b.id, clientRequestId }
      },
      CallAnswer
    )
  ).body;
}

async function action(
  api: Running,
  a: Account,
  id: string,
  command: CallActionBody['action'],
  expectedAttempt = 1,
  seatToken?: string,
  expectedRevision?: number
) {
  return (
    await request(
      api.socketPath,
      {
        method: 'POST',
        pathname: `${basePath}/${id}/actions`,
        cookie: a.cookie,
        body: { action: command, expectedAttempt, clientRequestId: randomUUID(), seatToken, expectedRevision }
      },
      CallAnswer
    )
  ).body;
}

async function details(api: Running, a: Account, id: string) {
  return (await request(api.socketPath, { pathname: `${basePath}/${id}`, cookie: a.cookie }, CallDetails)).body.call;
}

async function callEntry(api: Running, viewer: Account, peer: Account, messageId: string) {
  const { body } = await request(
    api.socketPath,
    {
      pathname: `/api/dm/${peer.id}/history?mode=around&messageId=${messageId}`,
      cookie: viewer.cookie
    },
    DirectHistoryPage
  );
  const row = body.messages.find(({ id }) => id === messageId);
  assert.ok(row && row.metadata?.kind === 'voice-call');
  return { row, call: row.metadata.call };
}

async function missedCounts(api: Running, account: Account) {
  return (await request(api.socketPath, { pathname: basePath, cookie: account.cookie }, CallBootstrap)).body.missed;
}

async function enter(socket: WsSession, answer: CallAnswer) {
  const { call, voiceAdmission } = answer;
  assert.ok(voiceAdmission);
  const id = randomUUID();
  sendRawWs(socket.ws, {
    id,
    type: 'call.voice.join',
    payload: { callId: call.id, seatToken: voiceAdmission.seatToken }
  });
  const frame = await waitForWsType(socket.frames, 'room.snapshot', (frame) => frame.id === id);
  assert.equal(frame.payload.roomId, voiceAdmission.roomId);
  assert.deepEqual(frame.payload.recentMessages, []);
  return voiceAdmission;
}

function state(socket: WsSession, id: string, phase: CallAnswer['call']['phase'], afterRevision = 0) {
  return waitForWsType(
    socket.frames,
    'call.state',
    ({ payload }) => payload.call.id === id && payload.call.phase === phase && payload.call.revision > afterRevision
  );
}

async function issue(api: Running, account: Account, id: string, seatToken: string) {
  return (
    await request(
      api.socketPath,
      {
        method: 'POST',
        pathname: `${basePath}/${id}/livekit-token`,
        cookie: account.cookie,
        body: { seatToken }
      },
      LiveKitAdmission
    )
  ).body;
}

async function until(check: () => boolean | Promise<boolean>, message: string) {
  const deadline = Date.now() + 5_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function promptly<T>(result: Promise<T>): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => timeout.reject(new Error('Operation stalled behind LiveKit removal')), 4_000);
  try {
    return await Promise.race([result, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

const micRecovery = {
  heard: [],
  rttMs: 40,
  jitterBufferMs: 30,
  uplink: { packets: 150, lost: 0 },
  transport: 'udp',
  mic: { expectedMs: 3_000, deliveredMs: 2_000, contextMs: 3_000, reopens: 1, replacements: 0 }
};

test('cross-dial coalesces, an accepting participant switches rooms, and late actions keep both seats', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b, outsider] = await Promise.all([api.account('alice'), api.account('bob'), api.account('eve')]);
  await lab.pool.query("UPDATE users SET display_name = '' WHERE id = $1", [a.id]);
  await befriend(api, a, b);
  const [aWs, bWs, outsiderWs] = await Promise.all([
    api.socket(a.cookie),
    api.socket(b.cookie),
    api.socket(outsider.cookie)
  ]);
  await lab.pool.query("INSERT INTO rooms(id,name) VALUES('ordinary','Team')");
  const watcher = await api.socket(outsider.cookie);
  await joinVoiceRoom(watcher, {
    roomId: 'ordinary',
    peerId: 'watcher-peer',
    sessionToken: 'a'.repeat(32),
    name: 'Watcher'
  });
  await joinVoiceRoom(bWs, { roomId: 'ordinary', peerId: 'bob-peer', sessionToken: 'b'.repeat(32), name: 'Bob' });

  const requestId = randomUUID();
  const outgoing = await start(api, a, b, requestId);
  const { id, startedAt } = outgoing.call;
  const aSeat = await enter(aWs, outgoing);
  assert.equal(outgoing.disposition, 'start');
  assert.equal(outgoing.call.caller.displayName, a.login);
  assert.equal(outgoing.call.recipient.displayName, b.login);
  assert.equal(outgoing.call.ringingExpiresAt, startedAt + 45_000);
  const incoming = await waitForWsType(bWs.frames, 'call.incoming');
  assert.equal(incoming.payload.callId, id);
  assert.equal(incoming.payload.fromUser.displayName, a.login);
  assert.equal((await start(api, a, b, requestId)).disposition, 'open');
  const accepted = await start(api, b, a);
  assert.equal(accepted.disposition, 'accept');
  assert.equal(accepted.call.id, id);
  const bSeat = await enter(bWs, accepted);
  await waitForWsType(watcher.frames, 'room.peer.left', ({ payload }) => payload.peerId === 'bob-peer');
  const connected = (await state(aWs, id, 'connected')).payload.call;
  assert.equal(connected.firstConnectedAt, startedAt);
  const token = await issue(api, a, id, aSeat.seatToken);
  assert.equal((await lab.gate.authorize(new URL(token.url).search)).ok, true);
  assert.equal((await action(api, b, id, 'accept')).disposition, 'stale');
  assert.equal((await action(api, b, id, 'decline')).disposition, 'stale');
  assert.equal((await details(api, a, id)).phase, 'connected');

  assert.equal((await request(api.socketPath, { pathname: `${basePath}/${id}`, cookie: outsider.cookie })).status, 404);
  assert.equal(
    (
      await request(api.socketPath, {
        method: 'POST',
        pathname: `${basePath}/${id}/livekit-token`,
        cookie: outsider.cookie,
        body: { seatToken: aSeat.seatToken }
      })
    ).status,
    404
  );
  sendRawWs(outsiderWs.ws, {
    id: 'third',
    type: 'call.voice.join',
    payload: { callId: id, seatToken: aSeat.seatToken }
  });
  assert.equal(
    (await waitForWsType(outsiderWs.frames, 'error', ({ id: requestId }) => requestId === 'third')).error.code,
    'call_not_found'
  );
  assert.equal(
    outsiderWs.frames.filter((frame) => frame.type === 'call.state' || frame.type === 'call.incoming').length,
    0
  );

  lab.advance(1_250);
  const left = await action(api, b, id, 'leave', 1, bSeat.seatToken);
  assert.equal(left.call.durationMs, 1_250);
  assert.equal(left.call.phase, 'alone');
  assert.equal(left.call.aloneDeadline, startedAt + 1_250 + 300_000);
  assert.equal((await action(api, b, id, 'leave', 1, bSeat.seatToken)).disposition, 'stale');
  const rejoined = await action(api, b, id, 'join');
  assert.equal(rejoined.disposition, 'resume');
  await enter(bWs, rejoined);
  await state(aWs, id, 'connected', left.call.revision);
  assert.equal((await action(api, b, id, 'leave', 1, bSeat.seatToken)).disposition, 'stale');
  assert.equal((await details(api, a, id)).phase, 'connected');
  const { rows } = await lab.pool.query<{ id: string }>('SELECT id FROM direct_messages');
  assert.equal(rows.length, 1);
  const thread = await request(api.socketPath, { pathname: `/api/dm/${b.id}`, cookie: a.cookie }, DirectThread);
  assert.equal(thread.body.messages[0]?.call?.callId, id);

  const active = await details(api, a, id);
  const moved = await action(api, a, id, 'join', 1, undefined, active.revision);
  assert.equal(moved.disposition, 'resume');
  const newTab = await api.socket(a.cookie);
  await enter(newTab, moved);
  assert.equal((await action(api, a, id, 'join', 1, undefined, active.revision)).disposition, 'stale');
  assert.equal((await action(api, a, id, 'leave', 1, aSeat.seatToken)).disposition, 'stale');
  assert.equal((await lab.gate.authorize(new URL(token.url).search)).ok, false);
  assert.equal((await details(api, a, id)).phase, 'connected');

  const [otherCall, ownCall] = await Promise.all([
    callEntry(api, b, a, active.messageId),
    callEntry(api, a, b, active.messageId)
  ]);
  assert.deepEqual(otherCall.call, ownCall.call);
  assert.equal(ownCall.row.author.userId, a.id);
  assert.equal(ownCall.row.recipientId, b.id);
  lab.advance(750);
  const resumed = await details(api, a, id);
  const ended = await action(api, a, id, 'leave', 1, moved.voiceAdmission?.seatToken, resumed.revision);
  assert.equal(ended.call.phase, 'alone');
  const bCurrent = await details(api, b, id);
  assert.equal(
    (await action(api, b, id, 'leave', 1, rejoined.voiceAdmission?.seatToken, bCurrent.revision)).call.phase,
    'closed'
  );
  const completed = await callEntry(api, b, a, active.messageId);
  assert.equal(completed.call.outcome, 'completed');
  assert.equal(completed.call.durationMs, 2_000);
  assert.equal(completed.row.createdAt, ownCall.row.createdAt);
  assert.equal(completed.row.editedAt, null);
});

test('two friends can ring the same account and a decline only closes its own attempt', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b, c] = await Promise.all([api.account('alice'), api.account('bob'), api.account('carol')]);
  await befriend(api, a, b);
  await befriend(api, c, b);
  const [aWs, bWs, cWs] = await Promise.all([api.socket(a.cookie), api.socket(b.cookie), api.socket(c.cookie)]);
  const [first, second] = await Promise.all([start(api, a, b), start(api, c, b)]);
  const aSeat = await enter(aWs, first);
  await enter(cWs, second);
  const bootstrap = (await request(api.socketPath, { pathname: basePath, cookie: b.cookie }, CallBootstrap)).body;
  assert.deepEqual(
    new Set(bootstrap.incoming.map((incoming) => incoming.callId)),
    new Set([first.call.id, second.call.id])
  );
  const declined = await action(api, b, first.call.id, 'decline');
  assert.equal(declined.call.endReason, 'declined');
  assert.equal(declined.call.endedByUserId, b.id);
  assert.equal((await callEntry(api, b, a, first.call.messageId)).call.outcome, 'declined');
  assert.deepEqual(await missedCounts(api, b), []);
  assert.ok(lab.evicted.some(({ roomId, peerId }) => roomId === aSeat.roomId && peerId === aSeat.peerId));
  const accepted = await action(api, b, second.call.id, 'accept');
  await enter(bWs, accepted);
  await state(cWs, second.call.id, 'connected');
  assert.equal((await details(api, a, first.call.id)).phase, 'closed');
});

test('the sweeper expires at 45 seconds, re-ring resets both clocks, and five minutes evicts only that call', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b] = await Promise.all([api.account('alice'), api.account('bob')]);
  await befriend(api, a, b);
  const aWs = await api.socket(a.cookie);
  const call = await start(api, a, b);
  const { id, startedAt } = call.call;
  const seat = await enter(aWs, call);
  const token = await issue(api, a, id, seat.seatToken);
  lab.advance(44_999);
  assert.equal((await details(api, a, id)).phase, 'ringing');
  lab.advance(1);
  const alone = (await state(aWs, id, 'alone')).payload.call;
  assert.equal(alone.serverNow, startedAt + 45_000);
  assert.equal(alone.attemptResult, 'no_answer');
  const missedWhileOpen = await callEntry(api, b, a, alone.messageId);
  assert.equal(missedWhileOpen.call.outcome, 'live');
  assert.equal(missedWhileOpen.call.missedAt, call.call.ringingExpiresAt);
  assert.equal(alone.aloneDeadline, startedAt + 300_000);
  assert.equal((await action(api, b, id, 'accept')).disposition, 'stale');

  const ring = await action(api, a, id, 're-ring');
  assert.equal(ring.call.attempt, 2);
  assert.equal(ring.call.ringingExpiresAt, startedAt + 90_000);
  assert.equal(ring.call.aloneDeadline, startedAt + 345_000);
  assert.equal((await action(api, a, id, 're-ring')).disposition, 'stale');
  assert.equal((await action(api, b, id, 'decline')).disposition, 'stale');
  lab.advance(299_999);
  assert.equal((await details(api, a, id)).phase, 'alone');
  assert.equal(lab.evicted.length, 0);
  lab.failRemoval(2);
  lab.advance(1);
  const closed = (await state(aWs, id, 'closed')).payload.call;
  assert.equal(closed.endedAt, startedAt + 345_000);
  assert.equal(closed.endReason, 'alone_timeout');
  assert.equal((await callEntry(api, b, a, closed.messageId)).call.outcome, 'no_answer');
  assert.equal((await missedCounts(api, b))[0]?.count, 1);
  assert.equal(closed.endedByUserId, a.id);
  assert.equal((await lab.gate.authorize(new URL(token.url).search)).ok, false);
  await waitForWsType(aWs.frames, 'room.left', ({ payload }) => payload.roomId === seat.roomId);
  await until(() => lab.evicted.some(({ peerId }) => peerId === seat.peerId), 'the failed removal was retried');

  lab.advance(86_399_999);
  assert.equal((await details(api, a, id)).phase, 'closed');
  lab.advance(1);
  const deadline = Date.now() + 5_000;
  while ((await request(api.socketPath, { pathname: `${basePath}/${id}`, cookie: a.cookie })).status === 200) {
    assert.ok(Date.now() < deadline, 'closed call should be pruned');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal((await lab.pool.query('SELECT id FROM rooms WHERE id=$1', [seat.roomId])).rowCount, 0);
  const { rows } = await lab.pool.query<{ outcome: string }>(
    "SELECT metadata->'call'->>'outcome' AS outcome FROM direct_messages"
  );
  assert.deepEqual(rows, [{ outcome: 'no_answer' }]);
});

class GateSocket extends EventEmitter {
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
  pipe<T>(destination: T): T {
    return destination;
  }
}

test('the gate tunnels a seated call credential and drops it when the seat leaves before upstream', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b] = await Promise.all([api.account('alice'), api.account('bob')]);
  await befriend(api, a, b);
  const aWs = await api.socket(a.cookie);
  const call = await start(api, a, b);
  const seat = await enter(aWs, call);
  const token = await issue(api, a, call.call.id, seat.seatToken);
  const url = `/rtc${new URL(token.url).search}&access_token=${token.token}`;
  const server = lab.gate.createServer();
  async function upgrade(beforeUpstream?: () => Promise<unknown>) {
    const client = new GateSocket();
    const upstream = new GateSocket();
    const connect = mock.method(net, 'connect', () => upstream);
    try {
      server.emit('upgrade', { url, headers: {} }, client, Buffer.alloc(0));
      await until(() => connect.mock.callCount() > 0, 'the gate opened its upstream');
      await beforeUpstream?.();
      upstream.emit('connect');
      await until(() => upstream.writes.length > 0 || upstream.destroyed, 'the gate decided the upgrade');
    } finally {
      connect.mock.restore();
    }
    return upstream;
  }

  assert.match((await upgrade()).writes[0] ?? '', /^GET \/rtc/);
  const late = await upgrade(async () => {
    await action(api, a, call.call.id, 'leave', 1, seat.seatToken);
    await until(
      () => lab.evicted.some(({ roomId, peerId }) => roomId === seat.roomId && peerId === seat.peerId),
      'the seat was removed before upstream connected'
    );
  });
  assert.deepEqual(late.writes, []);
  assert.equal(late.destroyed, true);
});

test('websocket leave fences token issuance and anonymizes diagnostics during a held LiveKit removal', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b] = await Promise.all([api.account('alice'), api.account('bob')]);
  await befriend(api, a, b);
  const [aWs, bWs] = await Promise.all([api.socket(a.cookie), api.socket(b.cookie)]);
  const call = await start(api, a, b);
  const { id } = call.call;
  await enter(aWs, call);
  const seat = await enter(bWs, await action(api, b, id, 'accept'));
  await state(aWs, id, 'connected');
  const credential = await issue(api, b, id, seat.seatToken);
  const gateUrl = new URL(credential.url).search;
  assert.equal((await lab.gate.authorize(gateUrl)).ok, true);
  const boundary = createCredentialBoundaryService({
    roomStore: createGateCredentialRepository({ db: kyselyOn(lab.pool) }),
    secret: gateSecret
  });
  const verified = Promise.withResolvers<void>();
  const continueGate = Promise.withResolvers<void>();
  const racingGate = createLiveKitAuthGateService({
    pool: lab.pool,
    superviseWidgets: false,
    boundary: {
      assertReady: boundary.assertReady,
      async authorizeCredential(value) {
        const result = await boundary.authorizeCredential(value);
        verified.resolve();
        await continueGate.promise;
        return result;
      }
    }
  });
  const racingDecision = racingGate.authorize(gateUrl);
  const target = { roomId: seat.roomId, peerId: seat.peerId, sessionToken: seat.seatToken };
  sendRawWs(bWs.ws, {
    type: 'room.voice.report',
    payload: { ...target, ...micRecovery }
  });
  const hold = lab.holdRemoval();
  try {
    await promptly(verified.promise);
    sendRawWs(bWs.ws, { type: 'room.leave', payload: target });
    await promptly(hold.started);
    const duringRemoval = await promptly(
      request(api.socketPath, {
        method: 'POST',
        pathname: `${basePath}/${id}/livekit-token`,
        cookie: b.cookie,
        body: { seatToken: seat.seatToken }
      })
    );
    assert.equal(duringRemoval.status, 404);
    assert.equal((await lab.gate.authorize(gateUrl)).ok, false);
    continueGate.resolve();
    assert.equal((await racingDecision).ok, false);
  } finally {
    continueGate.resolve();
    hold.unblock();
  }
  await until(() => lab.evicted.some(({ peerId }) => peerId === seat.peerId), 'the departed seat was removed');
  assert.equal((await lab.gate.authorize(gateUrl)).ok, false);
  assert.equal((await details(api, a, id)).phase, 'alone');
  for (const event of [LOG_EVENTS.ROOM_LEFT, LOG_EVENTS.ROOM_MIC_STALL_RECOVERY]) {
    const record = lab.logs.find((line) => line.includes(`"evt":"${event}"`));
    assert.ok(record, event);
    assert.doesNotMatch(record, /"(roomId|userId|connId)":/);
  }
});

test('closing a call fences socket commands even when LiveKit removal fails and is retried', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b] = await Promise.all([api.account('alice'), api.account('bob')]);
  await befriend(api, a, b);
  const socket = await api.socket(a.cookie);
  const call = await start(api, a, b);
  const seat = await enter(socket, call);
  const target = { roomId: seat.roomId, peerId: seat.peerId, sessionToken: seat.seatToken };
  lab.failRemoval(1);
  const hold = lab.holdRemoval();
  try {
    lab.advance(300_000);
    await state(socket, call.call.id, 'closed');
    await promptly(hold.started);
    sendRawWs(socket.ws, { id: 'closed-leave', type: 'room.leave', payload: target });
    sendRawWs(socket.ws, {
      type: 'room.voice.report',
      payload: { ...target, ...micRecovery }
    });
    sendRawWs(socket.ws, { id: 'closed-media', type: 'room.media.request', payload: { ...target, kind: 'camera' } });
    sendRawWs(socket.ws, {
      id: 'closed-update',
      type: 'room.peer.update',
      payload: { ...target, patch: { camera: true } }
    });
    await waitForWsType(socket.frames, 'error', ({ id }) => id === 'closed-media');
    await waitForWsType(socket.frames, 'error', ({ id }) => id === 'closed-update');
    assert.ok(!socket.frames.some((frame) => frame.id === 'closed-leave' || frame.type === 'room.media.grant'));
    assert.ok(!lab.logs.some((line) => line.includes(LOG_EVENTS.ROOM_MIC_STALL_RECOVERY)));
  } finally {
    hold.unblock();
  }
  await until(() => lab.evicted.some(({ peerId }) => peerId === seat.peerId), 'the failed removal was retried');
});

test('a re-ring invalidates the recipient’s unconsumed handoff and keeps the inviter seated', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b] = await Promise.all([api.account('alice'), api.account('bob')]);
  await befriend(api, a, b);
  const [aWs, bWs] = await Promise.all([api.socket(a.cookie), api.socket(b.cookie)]);
  const call = await start(api, a, b);
  const { id } = call.call;
  const inviter = await enter(aWs, call);
  lab.advance(45_000);
  const old = await action(api, b, id, 'join');
  assert.ok(old.voiceAdmission);

  const rerung = await action(api, a, id, 're-ring');
  assert.equal(rerung.call.attempt, 2);
  sendRawWs(bWs.ws, {
    id: 'old-handoff',
    type: 'call.voice.join',
    payload: { callId: id, seatToken: old.voiceAdmission.seatToken }
  });
  assert.equal(
    (await waitForWsType(bWs.frames, 'error', (frame) => frame.id === 'old-handoff')).error.code,
    'call_not_found'
  );
  await issue(api, a, id, inviter.seatToken);
  const accepted = await action(api, b, id, 'accept', 2);
  assert.notEqual(accepted.voiceAdmission?.seatToken, old.voiceAdmission.seatToken);
  await enter(bWs, accepted);
  await state(aWs, id, 'connected');
});

test('a friend who answered and left can be rung again at once despite the Ring rate window', async (t) => {
  const lab = await setup(t, { RING_RATE_LIMIT: '1', RING_RATE_WINDOW_MS: '30000' });
  const api = await lab.boot();
  const [a, b] = await Promise.all([api.account('alice'), api.account('bob')]);
  await befriend(api, a, b);
  const [aWs, bWs] = await Promise.all([api.socket(a.cookie), api.socket(b.cookie)]);
  const call = await start(api, a, b);
  const { id } = call.call;
  await enter(aWs, call);
  const accepted = await action(api, b, id, 'accept');
  const bSeat = await enter(bWs, accepted);
  await state(aWs, id, 'connected');

  lab.advance(5_000);
  assert.equal((await action(api, b, id, 'leave', 1, bSeat.seatToken)).call.phase, 'alone');
  const rerung = await action(api, a, id, 're-ring');
  assert.equal(rerung.call.attempt, 2);
  assert.equal(rerung.call.phase, 'ringing');
});

test('transferring the solo seat preserves a never-answered call’s history outcome', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b] = await Promise.all([api.account('alice'), api.account('bob')]);
  await befriend(api, a, b);
  const [first, second] = await Promise.all([api.socket(a.cookie), api.socket(a.cookie)]);
  const call = await start(api, a, b);
  const { id, messageId } = call.call;
  await enter(first, call);
  lab.advance(45_000);
  const alone = await details(api, a, id);
  const transfer = await action(api, a, id, 'join', 1, undefined, alone.revision);
  assert.equal(transfer.call.phase, 'alone');
  assert.equal(transfer.call.attemptResult, 'no_answer');
  const seat = await enter(second, transfer);
  const closed = await action(api, a, id, 'leave', 1, seat.seatToken);
  assert.equal(closed.call.endReason, 'no_answer');
  assert.equal((await callEntry(api, a, b, messageId)).call.outcome, 'no_answer');
});

test('a held LiveKit removal leaves another pair’s accept and legacy Ring delivery free to finish', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b, c, d] = await Promise.all([
    api.account('alice'),
    api.account('bob'),
    api.account('carol'),
    api.account('dave')
  ]);
  await Promise.all([befriend(api, a, b), befriend(api, c, d)]);
  const socket = await api.socket(a.cookie);
  const expiring = await start(api, a, b);
  await enter(socket, expiring);
  lab.advance(295_000);
  const separate = await start(api, c, d);
  await lab.pool.query("INSERT INTO rooms(id,name) VALUES('ordinary','Team')");
  const held = lab.holdRemoval();
  try {
    lab.advance(5_000);
    await promptly(held.started);
    const accept = await promptly(action(api, d, separate.call.id, 'accept'));
    assert.equal(accept.disposition, 'accept');
    const invitation = await request(
      api.socketPath,
      {
        method: 'POST',
        pathname: '/api/rings',
        body: { roomId: 'ordinary', userId: b.id, clientRequestId: randomUUID() },
        cookie: a.cookie
      },
      RingAnswer
    );
    assert.equal(invitation.status, 200);
    await until(
      async () =>
        (await lab.pool.query('SELECT 1 FROM ring_delivery_outbox WHERE ring_id=$1', [invitation.body.ring.id]))
          .rowCount === 0,
      'the ordinary Ring worker finished the invite delivery'
    );
  } finally {
    held.unblock();
  }
});

test('a leased seat reconnects, stops counting mutual time during the gap, then expires to a new solo clock', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b] = await Promise.all([api.account('alice'), api.account('bob')]);
  await befriend(api, a, b);
  const [aWs, bWs] = await Promise.all([api.socket(a.cookie), api.socket(b.cookie)]);
  const call = await start(api, a, b);
  const { id, startedAt } = call.call;
  await enter(aWs, call);
  const accepted = await action(api, b, id, 'accept');
  const bSeat = await enter(bWs, accepted);
  const oldToken = await issue(api, b, id, bSeat.seatToken);
  const connected = (await state(aWs, id, 'connected')).payload.call;
  lab.advance(2_000);
  bWs.ws.terminate();
  const reconnect = (await state(aWs, id, 'connecting', connected.revision)).payload.call;
  assert.equal(reconnect.seats?.find((seat) => seat.userId === b.id)?.reconnectUntil, startedAt + 2_000 + grace);
  assert.equal(reconnect.durationMs, 2_000);
  lab.advance(grace - 1);
  const replacement = await api.socket(b.cookie);
  await enter(replacement, accepted);
  const resumed = (await state(aWs, id, 'connected', reconnect.revision)).payload.call;
  assert.equal(resumed.durationMs, 2_000);
  assert.equal((await action(api, b, id, 'leave', 1, bSeat.seatToken, connected.revision)).disposition, 'stale');
  assert.equal((await lab.gate.authorize(new URL(oldToken.url).search)).ok, false);
  lab.advance(3_000);
  replacement.ws.terminate();
  const gap = (await state(aWs, id, 'connecting', resumed.revision)).payload.call;
  assert.equal(gap.durationMs, 5_000);
  const expiredAt = lab.advance(grace);
  const alone = (await state(aWs, id, 'alone', gap.revision)).payload.call;
  assert.equal(alone.aloneDeadline, expiredAt + 300_000);
  assert.equal(alone.seats?.find((seat) => seat.userId === b.id)?.status, 'absent');
  assert.equal(alone.durationMs, 5_000);

  aWs.ws.terminate();
  const peer = await api.socket(b.cookie);
  const soloGap = await details(api, b, id);
  assert.equal(soloGap.aloneDeadline, alone.aloneDeadline);
  lab.advance(10);
  const aReplacement = await api.socket(a.cookie);
  await enter(aReplacement, call);
  assert.equal((await details(api, b, id)).aloneDeadline, alone.aloneDeadline);
  await enter(peer, await action(api, b, id, 'join'));
  await state(aReplacement, id, 'connected');
});

test('block, unfriend, and account deletion close a call as unavailable', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const a = await api.account('alice');
  for (const change of ['block', 'unfriend', 'delete'] as const) {
    const b = await api.account(change);
    await befriend(api, a, b);
    const [aWs, bWs] = await Promise.all([api.socket(a.cookie), api.socket(b.cookie)]);
    const live = await start(api, a, b);
    const seat = await enter(aWs, live);
    await enter(bWs, await action(api, b, live.call.id, 'accept'));
    await state(aWs, live.call.id, 'connected');
    const token = await issue(api, a, live.call.id, seat.seatToken);
    const update =
      change === 'delete'
        ? {
            method: 'POST',
            pathname: '/api/auth/account/deletion',
            cookie: b.cookie,
            body: { currentPassword: 'password123' }
          }
        : change === 'unfriend'
          ? { method: 'DELETE', pathname: `/api/friends/${b.id}`, cookie: a.cookie }
          : { method: 'PUT', pathname: `/api/blocks/${b.id}`, cookie: a.cookie };
    const response = await request(api.socketPath, update);
    assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response.body));
    assert.equal((await lab.gate.authorize(new URL(token.url).search)).ok, false);
    assert.equal((await state(aWs, live.call.id, 'closed')).payload.call.endReason, 'unavailable');
    aWs.ws.terminate();
    bWs.ws.terminate();
  }
});

test('restart gives an empty call one lease of grace and disabling calls preserves existing actions', async (t) => {
  const lab = await setup(t);
  const original = await lab.boot();
  const [a, b, c] = await Promise.all([original.account('alice'), original.account('bob'), original.account('carol')]);
  await befriend(original, a, b);
  await befriend(original, a, c);
  const open = await start(original, a, b);
  const abandoned = await start(original, a, c);
  await original.close();
  const restartAt = lab.advance(15_000);
  const api = await lab.boot('false');
  const restart = await details(api, a, open.call.id);
  assert.equal(restart.phase, 'alone');
  assert.equal(restart.aloneDeadline, restartAt + grace);
  assert.equal(
    (
      await request(api.socketPath, {
        method: 'POST',
        pathname: basePath,
        cookie: a.cookie,
        body: { peerUserId: b.id, clientRequestId: randomUUID() }
      })
    ).body.code,
    'call_disabled'
  );
  const aWs = await api.socket(a.cookie);
  const resumed = await action(api, a, open.call.id, 'join');
  const seat = await enter(aWs, resumed);
  const refused = await request(api.socketPath, {
    method: 'POST',
    pathname: `${basePath}/${open.call.id}/actions`,
    cookie: a.cookie,
    body: { action: 're-ring', expectedAttempt: 1, clientRequestId: randomUUID() }
  });
  assert.equal(refused.body.code, 'call_disabled');
  assert.equal((await action(api, a, open.call.id, 'leave', 1, seat.seatToken)).call.phase, 'closed');
  lab.advance(grace - 1);
  assert.equal((await details(api, a, abandoned.call.id)).phase, 'alone');
  lab.advance(1);
  assert.equal((await state(aWs, abandoned.call.id, 'closed')).payload.call.endReason, 'no_answer');
});

test('restart preserves the last mutual checkpoint and starts without waiting for old LiveKit seats', async (t) => {
  const lab = await setup(t);
  const original = await lab.boot();
  const [a, b] = await Promise.all([original.account('alice'), original.account('bob')]);
  await befriend(original, a, b);
  const [aWs, bWs] = await Promise.all([original.socket(a.cookie), original.socket(b.cookie)]);
  const call = await start(original, a, b);
  const { id, messageId } = call.call;
  await enter(aWs, call);
  await enter(bWs, await action(original, b, id, 'accept'));
  await state(aWs, id, 'connected');
  lab.advance(4_000);
  await until(async () => {
    const { rows } = await lab.pool.query<{ mutual_ms: string }>(
      "SELECT mutual_ms FROM room_rings WHERE id=$1 AND call_phase='connected'",
      [id]
    );
    return Number(rows[0]?.mutual_ms) === 4_000;
  }, 'the sweeper checkpointed the connected interval');
  await original.close();

  const restartAt = lab.advance(90_000);
  const held = lab.holdRemoval();
  try {
    const api = await promptly(lab.boot());
    await promptly(held.started);
    const recovered = await details(api, a, id);
    assert.equal(recovered.phase, 'alone');
    assert.equal(recovered.aloneDeadline, restartAt + grace);
    assert.equal(recovered.durationMs, 4_000);
    lab.advance(grace);
    assert.equal((await details(api, a, id)).phase, 'closed');
    assert.equal((await callEntry(api, b, a, messageId)).call.durationMs, 4_000);
  } finally {
    held.unblock();
  }
});

test('the start quota ignores replays and the caller can cancel a ringing attempt', async (t) => {
  const lab = await setup(t, { RING_RATE_LIMIT: '1', RING_RATE_WINDOW_MS: '30000' });
  const api = await lab.boot();
  const [a, b, stranger] = await Promise.all([api.account('alice'), api.account('bob'), api.account('stranger')]);
  const tryStart = (peer: Account, clientRequestId = randomUUID()) =>
    request(api.socketPath, {
      method: 'POST',
      pathname: basePath,
      cookie: a.cookie,
      body: { peerUserId: peer.id, clientRequestId }
    });
  assert.equal((await tryStart(stranger)).body.code, 'not_friends');
  await befriend(api, a, b);
  const aWs = await api.socket(a.cookie);
  const requestId = randomUUID();
  const call = await start(api, a, b, requestId);
  const seat = await enter(aWs, call);
  const coalescedRequestId = randomUUID();
  assert.equal((await start(api, a, b, coalescedRequestId)).call.id, call.call.id);
  const cancelled = await action(api, a, call.call.id, 'leave', 1, seat.seatToken);
  assert.equal(cancelled.call.endReason, 'cancelled');
  assert.equal(cancelled.call.attemptResult, 'cancelled');
  const missed = await callEntry(api, b, a, call.call.messageId);
  assert.equal(missed.call.outcome, 'cancelled');
  assert.ok(missed.call.missedAt);
  assert.equal((await start(api, a, b, requestId)).call.id, call.call.id);
  assert.equal((await tryStart(stranger, requestId)).body.code, 'call_request_conflict');
  const limited = await tryStart(b);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '30');
  assert.equal(limited.body.code, 'call_rate_limited');
  lab.advance(30_000);
  assert.equal((await start(api, a, b, coalescedRequestId)).call.id, call.call.id);
  assert.notEqual((await start(api, a, b)).call.id, call.call.id);
});

test('misses acknowledge only through an issued watermark on both devices and clear on connection', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b, outsider] = await Promise.all([api.account('alice'), api.account('bob'), api.account('outsider')]);
  await befriend(api, a, b);
  const aWs = await api.socket(a.cookie);
  const bWs = await api.socket(b.cookie);
  const anotherDevice = await api.socket(b.cookie);

  const first = await start(api, a, b);
  const firstSeat = await enter(aWs, first);
  await action(api, a, first.call.id, 'leave', 1, firstSeat.seatToken);
  const [one] = await missedCounts(api, b);
  assert.ok(one?.watermark);
  assert.equal(one.count, 1);
  assert.equal(one.peerUserId, a.id);
  const firstEvent = await waitForWsType(bWs.frames, 'call.missed.updated', (frame) => frame.payload.count === 1);
  assert.deepEqual(firstEvent.payload.watermark, one.watermark);

  // A later committed miss can have the same timestamp as the previous mark.
  const second = await start(api, a, b);
  const secondSeat = await enter(aWs, second);
  await action(api, a, second.call.id, 'leave', 1, secondSeat.seatToken);
  const [two] = await missedCounts(api, b);
  assert.equal(two?.count, 2);
  assert.equal(two.watermark?.missedAt, one.watermark.missedAt);
  assert.equal(two.watermark?.messageId, second.call.messageId);
  assert.deepEqual(await missedCounts(api, a), []);

  const see = (viewer: Account, peer: Account, watermark: NonNullable<typeof one.watermark>) =>
    request(
      api.socketPath,
      {
        method: 'POST',
        pathname: `${basePath}/missed/${peer.id}/seen`,
        cookie: viewer.cookie,
        body: { watermark }
      },
      CallMissedSeenAnswer
    );
  assert.equal((await see(outsider, a, one.watermark)).body.count, 0);
  const ack = await see(b, a, one.watermark);
  assert.equal(ack.body.count, 1);
  assert.deepEqual(ack.body.watermark, two.watermark);
  for (const socket of [bWs, anotherDevice]) {
    const { payload } = await waitForWsType(
      socket.frames,
      'call.missed.updated',
      (f) => f.payload.revision === ack.body.revision
    );
    assert.equal(payload.count, 1);
  }
  assert.equal((await see(b, a, one.watermark)).body.count, 1);
  assert.ok(two.watermark);
  assert.equal((await see(b, a, two.watermark)).body.count, 0);

  const live = await start(api, a, b);
  await enter(aWs, live);
  const newMessage = await waitForWsType(bWs.frames, 'dm.message', (f) => f.payload.message.id === live.call.messageId);
  assert.equal(newMessage.payload.message.call?.revision, 1);
  lab.advance(44_999);
  assert.deepEqual(await missedCounts(api, b), []);
  lab.advance(1);
  const whileWaiting = await waitForWsType(
    bWs.frames,
    'dm.message.edited',
    (f) =>
      f.payload.message.call?.missedAt === live.call.ringingExpiresAt && f.payload.message.id === live.call.messageId
  );
  assert.equal((await missedCounts(api, b))[0]?.count, 1);
  const receiver = await action(api, b, live.call.id, 'join');
  await enter(anotherDevice, receiver);
  await state(aWs, live.call.id, 'connected');
  const latest = (await callEntry(api, b, a, live.call.messageId)).call;
  const stale = whileWaiting.payload.message.call;
  assert.ok(stale);
  assert.ok(latest.revision > stale.revision);
  assert.equal(latest.missedAt, null);
  assert.equal(await updateCallMessage(kyselyOn(lab.pool), live.call.messageId, stale), null);
  assert.deepEqual((await callEntry(api, b, a, live.call.messageId)).call, latest);
  assert.deepEqual(await missedCounts(api, b), []);
  const frames = aWs.frames.flatMap((frame) =>
    (frame.type === 'dm.message' || frame.type === 'dm.message.edited') &&
    frame.payload.message.id === live.call.messageId &&
    frame.payload.message.call
      ? [frame.payload.message.call.revision]
      : []
  );
  assert.ok(frames.length >= 3);
  assert.deepEqual(
    frames,
    [...new Set(frames)].sort((a, b) => a - b)
  );
});

test('voice call history cannot be edited, quoted or reacted to and supports deletion', async (t) => {
  const lab = await setup(t);
  const api = await lab.boot();
  const [a, b, outsider] = await Promise.all([api.account('alice'), api.account('bob'), api.account('outsider')]);
  await befriend(api, a, b);
  const aWs = await api.socket(a.cookie);
  const bWs = await api.socket(b.cookie);
  const started = await start(api, a, b);
  const seat = await enter(aWs, started);
  const { id, messageId } = started.call;
  const path = `/api/dm/${b.id}`;
  const edit = await request(api.socketPath, {
    method: 'PATCH',
    pathname: `${path}/messages/${messageId}`,
    cookie: a.cookie,
    body: { text: 'Changed' }
  });
  assert.equal(edit.body.code, 'message_edit_forbidden');
  const reply = await request(api.socketPath, {
    method: 'POST',
    pathname: path,
    cookie: a.cookie,
    body: { text: 'Reply', replyTo: { messageId } }
  });
  assert.equal(reply.body.code, 'reply_unavailable');
  const reaction = await request(api.socketPath, {
    method: 'PUT',
    pathname: `/api/reactions/dm/${b.id}/${messageId}`,
    cookie: a.cookie,
    body: { active: true, emoji: '👍' }
  });
  assert.equal(reaction.status, 404);
  const target = `${basePath}/notification/${id}`;
  assert.equal((await request(api.socketPath, { pathname: target, cookie: outsider.cookie })).status, 404);
  assert.equal(
    (await request(api.socketPath, { pathname: target, cookie: b.cookie }, CallNotificationTarget)).body.peerUserId,
    a.id
  );
  await action(api, a, id, 'leave', 1, seat.seatToken);
  const mark = await waitForWsType(bWs.frames, 'call.missed.updated', (frame) => frame.payload.count === 1);
  assert.equal(
    (
      await request(api.socketPath, {
        method: 'DELETE',
        pathname: `/api/friends/${b.id}`,
        cookie: a.cookie
      })
    ).status,
    200
  );
  const hidden = await waitForWsType(
    bWs.frames,
    'call.missed.updated',
    (frame) => frame.payload.revision > mark.payload.revision && frame.payload.count === 0
  );
  await befriend(api, a, b);
  const restored = await waitForWsType(
    bWs.frames,
    'call.missed.updated',
    (frame) => frame.payload.revision > hidden.payload.revision && frame.payload.count === 1
  );
  assert.equal(
    (
      await request(api.socketPath, {
        method: 'DELETE',
        pathname: `${path}/messages/${messageId}`,
        cookie: a.cookie
      })
    ).status,
    200
  );
  await waitForWsType(
    bWs.frames,
    'call.missed.updated',
    (frame) => frame.payload.revision > restored.payload.revision && frame.payload.count === 0
  );
  assert.deepEqual(await missedCounts(api, b), []);
  assert.equal((await request(api.socketPath, { pathname: target, cookie: b.cookie })).status, 404);
});
