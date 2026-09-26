import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  createModerationRepository,
  type ModerationBanRow,
  type ModerationCursorCodec,
  type ModerationRepository
} from '../src/domains/moderation/moderation.repository.ts';
import { createModerationService } from '../src/domains/moderation/moderation.service.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';
import { fake, fakeDb } from './fakes/index.ts';

function banRow(overrides: Partial<ModerationBanRow> = {}): ModerationBanRow {
  return {
    id: 'ban',
    room_id: 'room',
    user_id: null,
    reason: null,
    created_at: new Date(0),
    updated_at: null,
    expires_at: null,
    ...overrides
  };
}

// A room with an account ban and, a microsecond earlier, a guest ban.
async function bannedRoom(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: { log() {}, info() {}, warn() {}, error() {} } });
  await pool.query(`
    INSERT INTO users (id, login, display_name, password_hash, avatar_key, avatar_color_key)
    VALUES ('user-1', 'anna', 'Анна', 'x', 'a b.webp', 'coral');
    INSERT INTO rooms (id, is_static) VALUES ('room', true);
    INSERT INTO room_bans (id, room_id, user_id, ip, created_at) VALUES
      ('account-ban', 'room', 'user-1', '', '2026-08-01T12:00:00.000002Z'),
      ('guest-ban', 'room', NULL, '203.0.113.9', '2026-08-01T12:00:00.000001Z')`);
  return { pool };
}

const unusedCodec: ModerationCursorCodec = {
  encode: () => 'cursor',
  decode: () => {
    throw new Error('no cursor in this test');
  }
};

test('G86-A01 unauthorized ban requests do not resolve target principals', async () => {
  let resolutions = 0;
  const repository = fake<ModerationRepository>({
    async isRoomOwner() {
      return false;
    }
  });
  const pool = fakeDb();
  pool.connect = () => {
    throw new Error('transaction must not start');
  };
  const service = createModerationService({
    pool,
    repository,
    async resolvePrincipals() {
      resolutions += 1;
      return [];
    }
  });
  const result = await service.putBan({
    roomId: 'room',
    actorUserId: 'intruder',
    idempotencyKey: 'request-1',
    input: { userId: 'target', duration: '1h', reason: 'private owner note' }
  });
  assert.equal(result.status, 'forbidden');
  assert.equal(resolutions, 0);
});

test(
  'G86-A02 active-list cursor preserves PostgreSQL microseconds',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool } = await bannedRoom(t);
    const encoded: Array<Parameters<ModerationCursorCodec['encode']>[0]> = [];
    const cursorCodec: ModerationCursorCodec = {
      encode(value) {
        encoded.push(value);
        return `cursor-${encoded.length}`;
      },
      decode: (value) => {
        const tuple = encoded[Number(value.split('-')[1]) - 1]?.tuple;
        if (!tuple) throw new Error('unknown cursor');
        return tuple;
      }
    };
    const repository = createModerationRepository({ cursorCodec, pool });
    const first = await repository.listActive({ roomId: 'room', limit: 1 });
    assert.equal(first.nextCursor, 'cursor-1');
    assert.equal(encoded[0]?.tuple.createdAtMicros, String(Date.parse('2026-08-01T12:00:00Z') * 1000 + 2));
    const second = await repository.listActive({ roomId: 'room', limit: 1, cursor: first.nextCursor });
    assert.deepEqual(
      [...first.bans, ...second.bans].map((ban) => ban.id),
      ['account-ban', 'guest-ban'],
      'two bans a microsecond apart page apart'
    );
    assert.equal(second.hasMore, false);
    await assert.rejects(() => repository.listActive({ roomId: 'room', cursor: 'bogus' }), /Invalid moderation cursor/);
  }
);

test('G86-A03 public ban projection never exposes guest IP', () => {
  const repository = createModerationRepository({ cursorCodec: unusedCodec, pool: fakeDb() });
  // A stored guest ban carries the IP; the projection must drop it.
  const stored = { ...banRow(), ip: '203.0.113.9' };
  const projected = repository.mapModerationBan(stored);
  assert.deepEqual(projected?.subject, { kind: 'guest', userId: null });
  assert.equal(JSON.stringify(projected).includes('203.0.113.9'), false);
});

test(
  'G86-A04 active list names banned accounts and never profiles guests',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const { pool } = await bannedRoom(t);
    const repository = createModerationRepository({ cursorCodec: unusedCodec, pool });
    const { bans } = await repository.listActive({ roomId: 'room', limit: 10 });
    assert.deepEqual(bans[0]?.subject, {
      kind: 'account',
      userId: 'user-1',
      profile: {
        displayName: 'Анна',
        login: 'anna',
        avatarUrl: '/api/avatars/a%20b.webp',
        avatarColorKey: 'coral',
        avatarAccent: null
      }
    });
    assert.deepEqual(bans[1]?.subject, { kind: 'guest', userId: null });
    // A mutation row (no users join) keeps the profile-free projection.
    const mutation = repository.mapModerationBan(banRow({ id: 'x', user_id: 'user-1' }));
    assert.equal(mutation && 'profile' in mutation.subject, false);
  }
);
