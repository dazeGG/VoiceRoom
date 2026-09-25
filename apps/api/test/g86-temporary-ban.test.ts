import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createModerationRepository,
  type ModerationBanRow,
  type ModerationCursorCodec,
  type ModerationRepository
} from '../src/domains/moderation/moderation-repository.ts';
import { createModerationService } from '../src/domains/moderation/moderation-service.ts';
import { fake, fakeDb, result } from './fakes/index.ts';

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

test('G86-A02 active-list cursor preserves PostgreSQL microseconds', async () => {
  let encoded: Parameters<ModerationCursorCodec['encode']>[0] | undefined;
  const cursorCodec: ModerationCursorCodec = {
    ...unusedCodec,
    encode(value) {
      encoded = value;
      return 'cursor';
    }
  };

  const pool = fakeDb((sql) => {
    assert.match(sql, /EXTRACT\(EPOCH FROM rb\.created_at\).*1000000/);
    return result([
      banRow({ id: 'b', created_at_micros: '1234567' }),
      banRow({ id: 'a', created_at_micros: '1234566' })
    ]);
  });
  const page = await createModerationRepository({ cursorCodec, pool }).listActive({ roomId: 'room', limit: 1 });
  assert.equal(page.nextCursor, 'cursor');
  assert.equal(encoded?.tuple.createdAtMicros, '1234567');
  assert.equal(encoded?.tuple.id, 'b');
});

test('G86-A03 public ban projection never exposes guest IP', () => {
  const repository = createModerationRepository({ cursorCodec: unusedCodec, pool: fakeDb() });
  // A stored guest ban carries the IP; the projection must drop it.
  const stored = { ...banRow(), ip: '203.0.113.9' };
  const projected = repository.mapModerationBan(stored);
  assert.deepEqual(projected?.subject, { kind: 'guest', userId: null });
  assert.equal(JSON.stringify(projected).includes('203.0.113.9'), false);
});

test('G86-A04 active list names banned accounts and never profiles guests', async () => {
  const pool = fakeDb((sql) => {
    assert.match(sql, /LEFT JOIN users u ON u\.id = rb\.user_id/);
    return result([
      banRow({
        id: 'account-ban',
        user_id: 'user-1',
        login: 'anna',
        display_name: 'Анна',
        avatar_key: 'a b.webp',
        avatar_color_key: 'coral',
        avatar_accent: null
      }),
      { ...banRow({ id: 'guest-ban' }), ip: '203.0.113.9' }
    ]);
  });
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
});
