import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRingRepository } from '../src/domains/rings/ring.repository.ts';
import { createTestDatabase } from './db-harness.ts';

async function fixture(t: TestContext) {
  const db = await createTestDatabase(t);
  t.after(db.cleanup);
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  await db.pool.query(`INSERT INTO users(id,login,password_hash) VALUES($1,'ring-a','x'),($2,'ring-b','x')`, [a, b]);
  const [low, high] = [a, b].sort();
  await db.pool.query(`INSERT INTO friendships(id,user_a_id,user_b_id) VALUES($1,$2,$3)`, [
    crypto.randomUUID(),
    low,
    high
  ]);
  await db.pool.query(`INSERT INTO rooms(id,name) VALUES('ring-room','Team')`);
  const repo = createRingRepository({ pool: db.pool, isBanned: async () => false });
  return { ...db, a, b, repo };
}

test(
  'Ring creation replay is one atomic invitation and logical delivery',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, a, b, repo } = await fixture(t);
    const input = {
      callerUserId: a,
      recipientUserId: b,
      roomId: 'ring-room',
      clientRequestId: crypto.randomUUID(),
      ttlMs: 30000,
      cooldownMs: 0
    };
    const results = await Promise.all([repo.create(input), repo.create(input)]);
    assert.equal(results[0].status, 'rung');
    assert.equal(results[1].status, 'rung');
    if (results[0].status !== 'rung' || results[1].status !== 'rung') return;
    assert.equal(results[0].ring.id, results[1].ring.id);
    assert.equal((await pool.query('SELECT * FROM direct_messages')).rowCount, 1);
    assert.equal((await pool.query('SELECT * FROM ring_delivery_outbox')).rowCount, 1);
    const conflict = await repo.create({ ...input, roomId: 'different' });
    assert.equal(conflict.status, 'request_conflict');
  }
);

test(
  'Ring request key serializes concurrent different recipients before writing invitations',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, a, b, repo } = await fixture(t);
    const c = crypto.randomUUID();
    await pool.query(`INSERT INTO users(id,login,password_hash) VALUES($1,'ring-c','x')`, [c]);
    const [low, high] = [a, c].sort();
    await pool.query(`INSERT INTO friendships(id,user_a_id,user_b_id) VALUES($1,$2,$3)`, [
      crypto.randomUUID(),
      low,
      high
    ]);
    await pool.query(
      `CREATE FUNCTION delay_ring_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END; $$; CREATE TRIGGER delay_ring_insert BEFORE INSERT ON room_rings FOR EACH ROW EXECUTE FUNCTION delay_ring_insert()`
    );
    const input = {
      callerUserId: a,
      recipientUserId: b,
      roomId: 'ring-room',
      clientRequestId: crypto.randomUUID(),
      ttlMs: 30000,
      cooldownMs: 30000
    };
    const outcomes = await Promise.all([
      repo.create(input),
      repo.create({ ...input, recipientUserId: c, clientRequestId: input.clientRequestId.toUpperCase() })
    ]);
    assert.deepEqual(outcomes.map((result) => result.status).sort(), ['request_conflict', 'rung']);
    const winner = outcomes.find((result) => result.status === 'rung');
    assert.ok(winner?.status === 'rung');
    const winningInput = { ...input, recipientUserId: winner.ring.recipientUserId };
    const replay = await repo.create(winningInput);
    assert.equal(replay.status, 'rung');
    if (replay.status === 'rung') assert.equal(replay.replay, true);
    assert.equal((await repo.create({ ...winningInput, clientRequestId: crypto.randomUUID() })).status, 'rate_limited');
    assert.equal((await pool.query('SELECT * FROM room_rings')).rowCount, 1);
    assert.equal((await pool.query('SELECT * FROM direct_messages')).rowCount, 1);
    assert.equal((await pool.query('SELECT * FROM ring_delivery_outbox')).rowCount, 1);
  }
);

test(
  'Ring expiry wins when recipient authorization finishes after its deadline',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, a, b, repo } = await fixture(t);
    for (const action of ['accept', 'status'] as const) {
      const created = await repo.create({
        callerUserId: a,
        recipientUserId: b,
        roomId: 'ring-room',
        clientRequestId: crypto.randomUUID(),
        ttlMs: 60000,
        cooldownMs: 0
      });
      assert.equal(created.status, 'rung');
      if (created.status !== 'rung') return;
      const delayed = createRingRepository({
        pool,
        isBanned: async ({ client }) => {
          // Expire during authorization without depending on runner scheduling.
          await client.query(
            `UPDATE room_rings SET expires_at=clock_timestamp()+interval '100 milliseconds' WHERE id=$1`,
            [created.ring.id]
          );
          await client.query('SELECT pg_sleep(0.15)');
          return false;
        }
      });
      const ended = await delayed.act({ ringId: created.ring.id, actorUserId: b, action });
      assert.equal(ended?.state, 'expired');
      assert.equal(ended?.revision, 2);
      assert.equal(ended?.reason, undefined);
      assert.ok(ended?.endedAt && ended.endedAt >= ended.expiresAt);
      assert.equal(
        (
          await pool.query(`SELECT * FROM ring_delivery_outbox WHERE ring_id=$1 AND kind='terminal' AND revision=2`, [
            created.ring.id
          ])
        ).rowCount,
        2
      );
    }
  }
);

test(
  'Ring terminal winner is immutable and actor authorization precedes replay',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { a, b, repo } = await fixture(t);
    const created = await repo.create({
      callerUserId: a,
      recipientUserId: b,
      roomId: 'ring-room',
      clientRequestId: crypto.randomUUID(),
      ttlMs: 30000,
      cooldownMs: 0
    });
    assert.equal(created.status, 'rung');
    if (created.status !== 'rung') return;
    const outcomes = await Promise.all([
      repo.act({ ringId: created.ring.id, actorUserId: b, action: 'accept' }),
      repo.act({ ringId: created.ring.id, actorUserId: a, action: 'cancel' })
    ]);
    assert.equal(outcomes[0]?.state, outcomes[1]?.state);
    assert.equal(await repo.act({ ringId: created.ring.id, actorUserId: 'stranger', action: 'status' }), null);
    assert.equal(await repo.act({ ringId: created.ring.id, actorUserId: a, action: 'decline' }), null);
    assert.equal((await repo.act({ ringId: created.ring.id, actorUserId: b, action: 'status' }))?.revision, 2);
  }
);

test(
  'Ring expiry uses wall time after waiting for the shared pair lock',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, a, b, repo } = await fixture(t);
    const created = await repo.create({
      callerUserId: a,
      recipientUserId: b,
      roomId: 'ring-room',
      clientRequestId: crypto.randomUUID(),
      ttlMs: 60000,
      cooldownMs: 0
    });
    assert.equal(created.status, 'rung');
    if (created.status !== 'rung') return;
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      const { lockUserPair } = await import('../src/domains/social/social-records.ts');
      const { kyselyOn } = await import('../src/platform/db/kysely.ts');
      await lockUserPair(kyselyOn(holder), a, b);
      await holder.query(`UPDATE room_rings SET expires_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1`, [
        created.ring.id
      ]);
      const accepting = repo.act({ ringId: created.ring.id, actorUserId: b, action: 'accept' });
      await new Promise((resolve) => setTimeout(resolve, 750));
      await holder.query('COMMIT');
      assert.equal((await accepting)?.state, 'expired');
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  }
);

test(
  'Ring creation rolls back invitation and state when delivery persistence fails',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, a, b, repo } = await fixture(t);
    await pool.query(
      `CREATE FUNCTION reject_ring_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'outbox unavailable'; END; $$; CREATE TRIGGER reject_ring_delivery BEFORE INSERT ON ring_delivery_outbox FOR EACH ROW EXECUTE FUNCTION reject_ring_delivery()`
    );
    await assert.rejects(
      repo.create({
        callerUserId: a,
        recipientUserId: b,
        roomId: 'ring-room',
        clientRequestId: crypto.randomUUID(),
        ttlMs: 30000,
        cooldownMs: 0
      }),
      /outbox unavailable/
    );
    assert.equal((await pool.query('SELECT * FROM direct_messages')).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM room_rings')).rowCount, 0);
  }
);

test(
  'Ring creation refuses strangers, blocks, deleted accounts, cooldowns and missing rooms',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, a, b, repo } = await fixture(t);
    const create = (roomId = 'ring-room') =>
      repo.create({
        callerUserId: a,
        recipientUserId: b,
        roomId,
        clientRequestId: crypto.randomUUID(),
        ttlMs: 30000,
        cooldownMs: 30000
      });
    assert.equal((await create('missing')).status, 'room_not_found');
    await pool.query(`UPDATE users SET deletion_requested_at=clock_timestamp() WHERE id=$1`, [b]);
    assert.equal((await create()).status, 'account_deleted');
    await pool.query(`UPDATE users SET deletion_requested_at=NULL WHERE id=$1`, [b]);
    await pool.query(`INSERT INTO user_blocks(blocker_id,blocked_id) VALUES($1,$2)`, [b, a]);
    assert.equal((await create()).status, 'blocked');
    await pool.query('DELETE FROM user_blocks');
    await pool.query('DELETE FROM friendships');
    assert.equal((await create()).status, 'not_friends');
    const [low, high] = [a, b].sort();
    await pool.query(`INSERT INTO friendships(id,user_a_id,user_b_id) VALUES($1,$2,$3)`, [
      crypto.randomUUID(),
      low,
      high
    ]);
    assert.equal((await create()).status, 'rung');
    assert.equal((await create()).status, 'rate_limited');
  }
);

test(
  'Ring unavailable access closes pending state but never expires the invitation DM',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, a, b, repo } = await fixture(t);
    const created = await repo.create({
      callerUserId: a,
      recipientUserId: b,
      roomId: 'ring-room',
      clientRequestId: crypto.randomUUID(),
      ttlMs: 30000,
      cooldownMs: 0
    });
    assert.equal(created.status, 'rung');
    if (created.status !== 'rung') return;
    await pool.query('DELETE FROM rooms');
    const unavailable = await repo.act({ ringId: created.ring.id, actorUserId: b, action: 'accept' });
    assert.equal(unavailable?.state, 'cancelled');
    assert.equal(unavailable?.reason, 'unavailable');
    const dm = await pool.query<{ status: string }>(
      `SELECT metadata->>'status' AS status FROM direct_messages WHERE id=$1`,
      [created.ring.inviteMessageId]
    );
    assert.equal(dm.rows[0]?.status, 'pending');
    const job = await repo.claim();
    assert.ok(job);
    // Incoming jobs are never delivered after cancellation.
    if (job.kind === 'incoming') assert.equal(await repo.current(job), null);
  }
);

test(
  'Ring expiry, retention and rollback leave invitation messages intact',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool, a, b, repo, databaseUrl } = await fixture(t);
    const created = await repo.create({
      callerUserId: a,
      recipientUserId: b,
      roomId: 'ring-room',
      clientRequestId: crypto.randomUUID(),
      ttlMs: 30000,
      cooldownMs: 0
    });
    assert.equal(created.status, 'rung');
    if (created.status !== 'rung') return;
    await pool.query(
      `UPDATE room_rings SET created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1`,
      [created.ring.id]
    );
    await repo.maintenance();
    assert.equal((await repo.act({ ringId: created.ring.id, actorUserId: b, action: 'status' }))?.state, 'expired');
    const jobs = await pool.query<{ ring_id: string }>(
      `SELECT * FROM ring_delivery_outbox WHERE kind='terminal' AND deadline>clock_timestamp()`
    );
    assert.equal(jobs.rowCount, 2, 'terminal stop remains deliverable after original Ring expiry');
    await pool.query(`UPDATE room_rings SET created_at=clock_timestamp()-interval '25 hours' WHERE id=$1`, [
      created.ring.id
    ]);
    await repo.maintenance();
    assert.equal((await pool.query('SELECT * FROM room_rings')).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM direct_messages')).rowCount, 1);
    const { rollBackThrough } = await import('./migration-steps.ts');
    const { runMigrations } = await import('../src/lib/migrate.ts');
    await rollBackThrough(databaseUrl, '20261026150100_create_room_rings');
    assert.equal((await pool.query('SELECT * FROM direct_messages')).rowCount, 1);
    await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} } });
    assert.equal((await pool.query('SELECT * FROM room_rings')).rowCount, 0);
  }
);

test(
  'Ring accept checks recipient account and IP bans using the production ban service',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    const { createActiveBanService } = await import('../src/domains/moderation/active-ban.service.ts');
    const { createIpKey } = await import('../src/lib/ip-key.ts');
    const bans = createActiveBanService({ pool: f.pool, ipKeyOf: createIpKey('ring-test-secret') });
    const repository = createRingRepository({ pool: f.pool, isBanned: (input) => bans.isBanned(input) });
    const first = await repository.create({
      callerUserId: f.a,
      recipientUserId: f.b,
      roomId: 'ring-room',
      clientRequestId: crypto.randomUUID(),
      ttlMs: 30000,
      cooldownMs: 0
    });
    assert.equal(first.status, 'rung');
    if (first.status !== 'rung') return;
    await bans.createBan({ roomId: 'ring-room', ip: '203.0.113.7' });
    assert.equal(
      (await repository.act({ ringId: first.ring.id, actorUserId: f.a, action: 'status', ip: '203.0.113.7' }))?.state,
      'pending',
      'caller address is not the recipient address'
    );
    assert.equal(
      (await repository.act({ ringId: first.ring.id, actorUserId: f.b, action: 'accept', ip: '203.0.113.7' }))?.state,
      'cancelled'
    );
    const second = await repository.create({
      callerUserId: f.a,
      recipientUserId: f.b,
      roomId: 'ring-room',
      clientRequestId: crypto.randomUUID(),
      ttlMs: 30000,
      cooldownMs: 0
    });
    assert.equal(second.status, 'rung');
    if (second.status !== 'rung') return;
    await bans.createBan({ roomId: 'ring-room', userId: f.b });
    assert.equal(
      (await repository.act({ ringId: second.ring.id, actorUserId: f.b, action: 'accept', ip: '203.0.113.8' }))?.reason,
      'unavailable'
    );
  }
);

test(
  'Ring delivery claim fencing prevents an expired worker from acknowledging a newer claim',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await fixture(t);
    await f.repo.create({
      callerUserId: f.a,
      recipientUserId: f.b,
      roomId: 'ring-room',
      clientRequestId: crypto.randomUUID(),
      ttlMs: 30000,
      cooldownMs: 0
    });
    const old = await f.repo.claim();
    assert.ok(old);
    await f.pool.query(`UPDATE ring_delivery_outbox SET claimed_until=clock_timestamp()-interval '1 second'`);
    const newer = await f.repo.claim();
    assert.ok(newer);
    assert.notEqual(old.claim_token, newer.claim_token);
    assert.equal(await f.repo.current(old), null);
    await f.repo.finish(old);
    assert.equal((await f.pool.query('SELECT * FROM ring_delivery_outbox')).rowCount, 1);
    await f.repo.finish(newer);
    assert.equal((await f.pool.query('SELECT * FROM ring_delivery_outbox')).rowCount, 0);
  }
);
