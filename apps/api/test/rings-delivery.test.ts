import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type { PushPayload } from '@voice-room/shared/notifications';
import { isRecord } from '@voice-room/shared/guards';
import type { PushContext } from '../src/lib/push-service.ts';
import { createRingRepository } from '../src/domains/rings/ring.repository.ts';
import { createRingService } from '../src/domains/rings/ring.service.ts';
import { createTestDatabase } from './db-harness.ts';
import { storedUser } from './fakes/index.ts';

async function fixture(t: TestContext) {
  const db = await createTestDatabase(t);
  t.after(db.cleanup);
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  const [low, high] = [a, b].sort();
  await db.pool.query(`INSERT INTO users(id,login,password_hash) VALUES($1,'alice','x'),($2,'bob','x')`, [a, b]);
  await db.pool.query(`INSERT INTO friendships(id,user_a_id,user_b_id) VALUES($1,$2,$3)`, [
    crypto.randomUUID(),
    low,
    high
  ]);
  await db.pool.query(`INSERT INTO rooms(id,name) VALUES('ring-room','Private Room')`);
  const repository = createRingRepository({ pool: db.pool, isBanned: async () => false });
  const native: Array<{ userId: string; payload: PushPayload; context: PushContext }> = [],
    web: unknown[] = [],
    events: unknown[] = [];
  let fail = false,
    dnd = false,
    privateText = false;
  const service = createRingService({
    repository: () => repository,
    findUser: async (id) => storedUser({ id, login: 'alice', displayName: 'Alice' }),
    findRoom: async () => ({ id: 'ring-room', name: 'Private Room', emoji: 'x' }),
    notifyUser: (id, event) => events.push([id, event]),
    queueWebPush: async (...args) => {
      web.push(args);
    },
    nativePush: async (userId, payload, context) => {
      if (fail) throw new Error('temporary provider outage');
      assert.ok(isRecord(payload));
      const typed: PushPayload = {
        type: typeof payload.type === 'string' ? payload.type : '',
        body: typeof payload.body === 'string' ? payload.body : '',
        url: typeof payload.url === 'string' ? payload.url : ''
      };
      native.push({ userId, payload: typed, context });
    },
    preferences: async () => ({ doNotDisturb: dnd, mutedPeerIds: [], privateNotifications: privateText }),
    ttlMs: 30000,
    windowMs: 30000,
    maxCount: 1
  });
  return {
    ...db,
    a,
    b,
    service,
    repository,
    native,
    web,
    events,
    setFail: (value: boolean) => {
      fail = value;
    },
    setDnd: (value: boolean) => {
      dnd = value;
    },
    setPrivate: (value: boolean) => {
      privateText = value;
    }
  };
}

test(
  'Ring creation emits legacy events once, uses web-only cue and native durable delivery',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    const key = crypto.randomUUID();
    const create = () =>
      f.service.create(storedUser({ id: f.a, login: 'alice', displayName: 'Alice' }), 'ring-room', f.b, key);
    const first = await create();
    assert.equal(first.status, 'rung');
    assert.equal((await create()).status, 'rung');
    assert.equal(f.events.length, 3);
    assert.equal(f.web.length, 1);
    assert.equal(f.native.length, 0);
    await f.service.drainOnce();
    assert.equal(f.native.length, 1);
    assert.equal(f.native[0]?.payload.type, 'ring');
    assert.equal(f.native[0]?.context.strictPartialFailures, true);
    assert.equal(f.native[0]?.context.nativeData && typeof f.native[0].context.nativeData === 'object', true);
  }
);

test(
  'Ring terminal delivery is native-only, bypasses DND and retries temporary provider failure',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    const first = await f.service.create(storedUser({ id: f.a }), 'ring-room', f.b, crypto.randomUUID());
    assert.equal(first.status, 'rung');
    if (first.status !== 'rung') return;
    await f.service.drainOnce();
    await f.service.act(first.ring.id, f.a, 'cancel');
    f.setDnd(true);
    f.setFail(true);
    await assert.rejects(f.service.drainOnce(), /temporary provider/);
    assert.equal(
      (await f.pool.query(`SELECT * FROM ring_delivery_outbox WHERE attempts=1 AND claim_token IS NULL`)).rowCount,
      1
    );
    f.setFail(false);
    await f.pool.query('UPDATE ring_delivery_outbox SET available_at=clock_timestamp()');
    while (await f.service.drainOnce()) {
      /* Drain both recipient and caller terminal jobs. */
    }
    assert.equal(f.web.length, 1, 'terminal changes never fan out to Web Push');
    const terminal = f.native.filter((entry) => entry.payload.type === 'ring.state');
    assert.equal(terminal.length, 2);
    assert.equal(
      terminal.every((entry) => entry.payload.url === ''),
      true
    );
  }
);

test(
  'Ring privacy is applied before native delivery and DND suppresses pending cues',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    f.setPrivate(true);
    await f.service.create(storedUser({ id: f.a }), 'ring-room', f.b, crypto.randomUUID());
    await f.service.drainOnce();
    assert.equal(f.native[0]?.payload.body, 'Вас зовут в голосовую комнату.');
    assert.equal(JSON.stringify(f.native[0]?.context.nativeData).includes('Private Room'), false);
    await f.pool.query(`UPDATE room_rings SET created_at=clock_timestamp()-interval '1 hour'`);
    f.setDnd(true);
    await f.service.create(storedUser({ id: f.a }), 'ring-room', f.b, crypto.randomUUID());
    await f.service.drainOnce();
    assert.equal(f.native.length, 1);
  }
);
