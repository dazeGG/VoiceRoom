import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomStore } from '../src/app/room-store.ts';
import { createActiveBanRepository } from '../src/domains/moderation/active-ban.repository.ts';
import {
  createModerationRepository,
  type ModerationCursorCodec
} from '../src/domains/moderation/moderation.repository.ts';
import { createModerationService } from '../src/domains/moderation/moderation.service.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { lockKeys } from '../src/platform/db/locks.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const PAST = Date.parse('2026-01-02T03:04:05.000Z');
// A stand-in for the address keyer: every writer must store this, never the address.
const ipKeyOf = (ip: string) => {
  const text = ip.trim();
  return text ? `key:${text}` : null;
};
const keyed = (ip: string) => `key:${ip}`;

async function migrated(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  await pool.query(`INSERT INTO rooms (id, is_static) VALUES ('room', true)`);
  return pool;
}

type StoredBan = {
  ip: string;
  user_id: string | null;
  metadata: unknown;
  reason: string;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
};

async function stored(pool: Awaited<ReturnType<typeof migrated>>, id: string): Promise<StoredBan> {
  const { rows } = await pool.query<StoredBan>(
    'SELECT ip, user_id, metadata, reason, created_at, updated_at, expires_at FROM room_bans WHERE id = $1',
    [id]
  );
  const row = rows[0];
  assert.ok(row, 'the ban row exists');
  return row;
}

// Every room_bans writer stores the same invariant: the moment of the ban is
// both created_at and updated_at, an account ban carries no address, a guest
// ban stores the address key, and metadata is always an object.

test('the owner ban writer stamps updated_at with the ban moment and keys the address', async (t) => {
  const pool = await migrated(t);
  const store = createRoomStore({ pool, ipKeyOf });
  const result = await store.createRoomBan({ roomId: 'room', ip: ' 203.0.113.8 ', now: PAST });
  assert.ok(result.ban);
  const row = await stored(pool, result.ban.id);
  assert.equal(row.ip, keyed('203.0.113.8'));
  assert.equal(row.created_at.getTime(), PAST);
  assert.equal(row.updated_at.getTime(), PAST);
  assert.deepEqual(row.metadata, {});
  assert.equal(row.reason, '');
  assert.equal(row.expires_at, null);
});

test('the gate-revocation ban writer stores an object even for array metadata', async (t) => {
  const pool = await migrated(t);
  const store = createRoomStore({ pool, ipKeyOf });
  const result = await store.createRoomBanWithLiveKitGateRevocations({
    roomId: 'room',
    ip: '203.0.113.9',
    metadata: ['x'],
    principals: [{ principalType: 'guest', principalId: 'guest-1' }],
    now: PAST
  });
  assert.ok(result.ban);
  const row = await stored(pool, result.ban.id);
  assert.deepEqual(row.metadata, {});
  assert.equal(row.updated_at.getTime(), PAST);
});

test('the moderation writer keeps its reason, key, expiry and updated_at', async (t) => {
  const pool = await migrated(t);
  const repository = createModerationRepository({
    cursorCodec: { encode: () => 'cursor', decode: () => ({ createdAtMicros: '0', id: '' }) },
    pool,
    ipKeyOf
  });
  const ban = await repository.create({
    roomId: 'room',
    guestIp: '203.0.113.7',
    expiresAt: PAST + 60_000,
    reason: 'spam',
    idempotencyKey: 'key-1',
    at: PAST
  });
  assert.ok(ban);
  const row = await stored(pool, ban.id);
  assert.deepEqual(
    [row.ip, row.reason, row.created_at.getTime(), row.updated_at.getTime(), row.expires_at?.getTime()],
    [keyed('203.0.113.7'), 'spam', PAST, PAST, PAST + 60_000]
  );
  assert.deepEqual(row.metadata, {});
});

test('the active-ban writer stamps updated_at with the ban moment', async (t) => {
  const pool = await migrated(t);
  const repository = createActiveBanRepository({ pool, ipKeyOf });
  const ban = await repository.insert({ roomId: 'room', ip: '203.0.113.6', metadata: { a: 1 }, at: PAST });
  assert.ok(ban);
  const row = await stored(pool, ban.id);
  assert.equal(row.updated_at.getTime(), PAST);
  assert.deepEqual(row.metadata, { a: 1 });
});

// A ban and a membership admission in the same room exclude each other: while
// an admission holds the room's admission lock, no ban writer may insert.
type Pool = Awaited<ReturnType<typeof migrated>>;

async function banWaitsForAdmission(pool: Pool, ban: () => Promise<unknown>) {
  const holder = await pool.connect();
  try {
    await holder.query('BEGIN');
    await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKeys.admission('room')]);
    let settled = false;
    const writing = ban().finally(() => {
      settled = true;
    });
    // Poll until the writer is parked on an advisory lock, or it finished without waiting.
    while (!settled) {
      const { rows } = await pool.query<{ one: number }>(
        `SELECT 1 AS one FROM pg_stat_activity WHERE datname = current_database() AND wait_event = 'advisory'`
      );
      if (rows.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(settled, false, 'the ban writer waits for the admission lock');
    const { rows } = await pool.query<{ n: number }>('SELECT count(*)::int AS n FROM room_bans');
    assert.equal(rows[0]?.n, 0, 'nothing is inserted while the admission is open');
    await holder.query('COMMIT');
    await writing;
  } finally {
    holder.release();
  }
}

test('the owner ban writer waits for a membership admission in the room', async (t) => {
  const pool = await migrated(t);
  const store = createRoomStore({ pool, ipKeyOf });
  await banWaitsForAdmission(pool, () => store.createRoomBan({ roomId: 'room', ip: '203.0.113.8' }));
});

test('the gate-revocation ban writer waits for a membership admission in the room', async (t) => {
  const pool = await migrated(t);
  const store = createRoomStore({ pool, ipKeyOf });
  await banWaitsForAdmission(pool, () =>
    store.createRoomBanWithLiveKitGateRevocations({
      roomId: 'room',
      ip: '203.0.113.9',
      principals: [{ principalType: 'guest', principalId: 'guest-1' }]
    })
  );
});

test('the owner moderation ban waits for a membership admission in the room', async (t) => {
  const pool = await migrated(t);
  await pool.query(`
    INSERT INTO users (id, login, display_name, password_hash, avatar_key, avatar_color_key)
    VALUES ('owner', 'owner', 'Owner', 'x', '', 'coral');
    UPDATE rooms SET owner_id = 'owner' WHERE id = 'room'`);
  const cursorCodec: ModerationCursorCodec = {
    encode: () => 'cursor',
    decode: () => {
      throw new Error('no cursor in this test');
    }
  };
  const service = createModerationService({
    pool,
    repository: createModerationRepository({ cursorCodec, pool, ipKeyOf }),
    resolvePrincipals: async () => [],
    revokePrincipalInTransaction: async () => {
      throw new Error('no credential to revoke in this test');
    },
    afterBanCommitted: () => undefined
  });
  await banWaitsForAdmission(pool, async () => {
    const result = await service.putBan({
      roomId: 'room',
      actorUserId: 'owner',
      idempotencyKey: 'ban-1',
      input: { guestIp: '203.0.113.10', duration: '1h' }
    });
    assert.equal(result.status, 'created');
  });
});
