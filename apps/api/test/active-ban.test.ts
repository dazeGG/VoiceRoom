import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { test } from 'node:test';
import {
  createActiveBanRepository,
  type ActiveBanRepository
} from '../src/domains/moderation/active-ban.repository.ts';
import { createActiveBanService } from '../src/domains/moderation/active-ban.service.ts';
import { createIpKey } from '../src/lib/ip-key.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createRoomStore } from '../src/app/room-store.ts';
import {
  MentionEligibilityError,
  createMentionEligibilityService
} from '../src/domains/notifications/mention-eligibility.service.ts';
import { createTestDatabase } from './db-harness.ts';
import { fake, fakeDb } from './fakes/index.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const ipKeyOf = createIpKey('active-ban-test-secret');

test(
  'G41-A01 active-ban repository applies one expiry and revocation predicate',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await runMigrations({ databaseUrl, logger: SILENT });
    const now = Date.parse('2026-09-01T12:00:00Z');
    await pool.query(`
      INSERT INTO users (id, login, display_name, password_hash)
      VALUES ('live', 'live', 'L', 'x'), ('expired', 'expired', 'E', 'x'), ('revoked', 'revoked', 'R', 'x'), ('later', 'later', 'T', 'x');
      INSERT INTO rooms (id, is_static) VALUES ('room', true);
      INSERT INTO room_bans (id, room_id, user_id, ip, expires_at, revoked_at) VALUES
        ('b-live', 'room', 'live', '', NULL, NULL),
        ('b-expired', 'room', 'expired', '', '2026-09-01T11:00:00Z', NULL),
        ('b-revoked', 'room', 'revoked', '', NULL, '2026-09-01T10:00:00Z'),
        ('b-later', 'room', 'later', '', '2026-09-01T13:00:00Z', NULL),
        ('b-guest', 'room', NULL, '${ipKeyOf('203.0.113.7')}', NULL, NULL)`);
    const repository = createActiveBanRepository({ pool, ipKeyOf, now: () => now });
    const users = ['live', 'expired', 'revoked', 'later', 'live'];

    assert.deepEqual((await repository.filterActiveUserIds({ roomId: 'room', userIds: users })).sort(), [
      'later',
      'live'
    ]);
    assert.equal(await repository.countActive('room'), 3, 'live, later and the guest');
    for (const userId of ['expired', 'revoked']) {
      assert.equal(await repository.findActive({ roomId: 'room', userId }), null, userId);
    }
    assert.equal((await repository.findActive({ roomId: 'room', userId: 'later' }))?.id, 'b-later');
    assert.equal(
      (await repository.findActive({ roomId: 'room', userId: 'later', at: now + 2 * 3600_000 }))?.id,
      undefined
    );
    assert.equal((await repository.findActive({ roomId: 'room', ip: '203.0.113.7' }))?.id, 'b-guest');
    assert.equal(
      (await repository.findActive({ roomId: 'room', userId: 'nobody', ip: '203.0.113.7' }))?.id,
      'b-guest',
      'an unbanned account on a banned address is stopped by the address ban'
    );
    assert.equal(await repository.findActive({ roomId: 'room' }), null);
    assert.equal(await repository.countActive(undefined), 0);
    assert.deepEqual(await repository.filterActiveUserIds({ roomId: 'room', userIds: [] }), []);

    const inserted = await repository.insert({
      roomId: 'room',
      userId: 'expired',
      ip: '198.51.100.1',
      expiresAt: now + 1000
    });
    assert.deepEqual([inserted?.userId, inserted?.ip, inserted?.expiresAt], ['expired', '', now + 1000]);
    assert.equal(await repository.insert({ roomId: 'room' }), null);

    const key = ipKeyOf('203.0.113.7');
    assert.deepEqual(repository.normalizePrincipal({ userId: 'user', ip: '203.0.113.7' }), { userId: 'user', ip: '' });
    assert.deepEqual(repository.normalizePrincipal({ ip: '203.0.113.7' }), { userId: null, ip: key });
    assert.deepEqual(repository.normalizePrincipal({ ip: key }), { userId: null, ip: key }, 'a key stays a key');
    assert.deepEqual(repository.normalizePrincipal({ ip: 'unknown' }), { userId: null, ip: '' });
  }
);

test('G41-A01 eligibility filtering uses the same repository predicate for all user paths', async () => {
  const calls: Array<{ userIds?: unknown; at?: unknown } | undefined> = [];

  const repository = fake<ActiveBanRepository>({
    async filterActiveUserIds(input) {
      calls.push(input);
      return ['banned'];
    }
  });
  const service = createActiveBanService({ pool: fakeDb(), ipKeyOf, repository, now: () => 42 });
  assert.deepEqual(
    await service.filterEligibleUserIds({
      roomId: 'room',
      userIds: ['allowed', 'banned', 'allowed']
    }),
    ['allowed']
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.userIds, ['allowed', 'banned']);
  assert.equal(calls[0]?.at, 42);
});

// An expired ban no longer counts on any path that reads bans: the room
// store's lookup and mention eligibility share the active-ban service.
test(
  'G41-A02 room store and mention eligibility ignore an expired ban and honour a live one',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { cleanup, databaseUrl } = await createTestDatabase(t);
    await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} }, noLock: true });
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    t.after(async () => {
      await pool.end();
      await cleanup();
    });
    await pool.query(
      `INSERT INTO users (id, login, display_name, password_hash) VALUES ('owner', 'g41owner', 'Owner', 'x'), ('target', 'g41target', 'Target', 'x')`
    );
    await pool.query(`INSERT INTO rooms (id, creator_ip) VALUES ('g41-paths', '')`);
    await pool.query(
      `INSERT INTO room_memberships (id, room_id, user_id, role) VALUES ('m1', 'g41-paths', 'owner', 'owner'), ('m2', 'g41-paths', 'target', 'member')`
    );
    await pool.query(
      `INSERT INTO room_bans (id, room_id, user_id, ip, created_at, expires_at, metadata) VALUES ('old', 'g41-paths', 'target', '', now() - interval '2 hours', now() - interval '1 hour', '{}'::jsonb)`
    );

    const store = createRoomStore({ pool });
    const mentions = createMentionEligibilityService({
      pool,
      activeBanService: createActiveBanService({ pool, ipKeyOf })
    });
    assert.equal(await store.findActiveRoomBan({ roomId: 'g41-paths', userId: 'target' }), null);
    assert.deepEqual(
      await mentions.validate({ roomId: 'g41-paths', creatorUserId: 'owner', targetUserIds: ['target'] }),
      ['target']
    );

    await pool.query(
      `INSERT INTO room_bans (id, room_id, user_id, ip, created_at, expires_at, metadata) VALUES ('live', 'g41-paths', 'target', '', now(), now() + interval '1 hour', '{}'::jsonb)`
    );
    assert.equal((await store.findActiveRoomBan({ roomId: 'g41-paths', userId: 'target' }))?.id, 'live');
    await assert.rejects(
      mentions.validate({ roomId: 'g41-paths', creatorUserId: 'owner', targetUserIds: ['target'] }),
      MentionEligibilityError
    );
  }
);

test(
  'G41-A02 exact expiry unblocks and one hundred expired rows consume zero active cap in PostgreSQL',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { cleanup, databaseUrl } = await createTestDatabase(t);
    await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} }, noLock: true });
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    t.after(async () => {
      await pool.end();
      await cleanup();
    });
    const now = Date.parse('2026-08-06T12:00:00.000Z');
    await pool.query(
      `INSERT INTO users (id, login, display_name, password_hash) VALUES ('g41-user', 'g41user', 'G41 User', 'fixture')`
    );
    await pool.query(`INSERT INTO rooms (id, creator_ip) VALUES ('g41-room', '')`);
    await pool.query(
      `
    INSERT INTO room_bans (id, room_id, user_id, ip, created_at, expires_at, metadata)
    SELECT 'g41-expired-' || value, 'g41-room', 'g41-user', '', $1::timestamptz - interval '2 seconds', $1::timestamptz - interval '1 second', '{}'::jsonb
    FROM generate_series(1, 100) AS value
  `,
      [new Date(now)]
    );
    const service = createActiveBanService({ pool, ipKeyOf, now: () => now });
    assert.equal(await service.getActiveBan({ roomId: 'g41-room', userId: 'g41-user' }), null);
    const created = await service.createBan({
      roomId: 'g41-room',
      userId: 'g41-user',
      expiresAt: now + 1_000,
      maxActiveBans: 1
    });
    assert.equal(created.status, 'created');
    assert.equal((await service.getActiveBan({ roomId: 'g41-room', userId: 'g41-user' }))?.id, created.ban?.id);

    assert.equal(await service.getActiveBan({ roomId: 'g41-room', userId: 'g41-user', at: now + 1_000 }), null);
  }
);

// Bans stored by address before 2.10.4 are rewritten to keys in batches; a key,
// an empty address and something that is not an address are left as they are or
// emptied, and a second pass finds nothing to do.
test(
  'G41-A03 stored addresses become keys in batches and keep banning',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
    t.after(cleanup);
    await runMigrations({ databaseUrl, logger: SILENT });
    const key = ipKeyOf('192.0.2.1') ?? '';
    await pool.query(`
      INSERT INTO users (id, login, display_name, password_hash) VALUES ('member', 'member', 'M', 'x');
      INSERT INTO rooms (id, is_static) VALUES ('room', true);
      INSERT INTO room_bans (id, room_id, user_id, ip) VALUES
        ('v4', 'room', NULL, '203.0.113.7'),
        ('v6', 'room', NULL, '2001:db8:1:2::5'),
        ('mapped', 'room', NULL, '::ffff:198.51.100.4'),
        ('account', 'room', 'member', '203.0.113.8'),
        ('junk', 'room', NULL, 'not.an:address'),
        ('keyed', 'room', NULL, '${key}'),
        ('empty', 'room', 'member', '')`);
    const repository = createActiveBanRepository({ pool, ipKeyOf });

    assert.equal(await repository.keyStoredAddresses({ batchSize: 2 }), 5);
    const rows = await pool.query<{ id: string; ip: string }>(`SELECT id, ip FROM room_bans ORDER BY id`);
    assert.deepEqual(Object.fromEntries(rows.rows.map((row) => [row.id, row.ip])), {
      account: ipKeyOf('203.0.113.8'),
      empty: '',
      junk: '',
      keyed: key,
      mapped: ipKeyOf('198.51.100.4'),
      v4: ipKeyOf('203.0.113.7'),
      v6: ipKeyOf('2001:db8:1:2::5')
    });
    assert.equal(await repository.keyStoredAddresses(), 0, 'a second pass changes nothing');

    assert.equal((await repository.findActive({ roomId: 'room', ip: '203.0.113.7' }))?.id, 'v4');
    assert.equal((await repository.findActive({ roomId: 'room', ip: '2001:db8:1:2:ffff::1' }))?.id, 'v6');
    assert.equal((await repository.findActive({ roomId: 'room', ip: '198.51.100.4' }))?.id, 'mapped');
    assert.equal(await repository.findActive({ roomId: 'room', ip: '2001:db8:1:3::5' }), null);

    const inserted = await repository.insert({ roomId: 'room', ip: '2001:db8:7::1' });
    assert.equal(inserted?.ip, ipKeyOf('2001:db8:7::1'), 'a new guest ban stores the key');
  }
);
