// The user store over a migrated database: avatar colours, avatars, and
// sessions that keep only a hash of their token.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';

import { createUserStore, hashSessionToken, publicUser } from '../src/lib/user-store.ts';
import { AVATAR_COLOR_KEYS } from '@voice-room/shared/validation';
import { runMigrations } from '../src/lib/migrate.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

async function setup(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  return { pool, store: createUserStore({ pool, logger: SILENT }) };
}

test('createUser keeps a valid avatar colour and replaces an invalid one', { skip }, async (t) => {
  const { store } = await setup(t);
  const chosen = await store.createUser({
    avatarColorKey: 'rose',
    displayName: 'Ada',
    login: 'ada',
    password: 'password123'
  });
  assert.equal(chosen.status, 'created');
  assert.equal(chosen.user?.avatarColorKey, 'rose');
  assert.equal(publicUser(chosen.user)?.avatarColorKey, 'rose');
  assert.equal('passwordHash' in (publicUser(chosen.user) ?? {}), false);

  const invalid = await store.createUser({ avatarColorKey: 'neon-unbounded', login: 'grace', password: 'password123' });
  assert.ok(invalid.user);
  assert.ok(AVATAR_COLOR_KEYS.includes(invalid.user.avatarColorKey));
  assert.equal((await store.getUserById(invalid.user.id))?.avatarColorKey, invalid.user.avatarColorKey);
});

test('publicUser exposes avatar URL and accent without leaking the storage key', () => {
  const user = publicUser({
    id: '123e4567-e89b-12d3-a456-426614174000',
    login: 'ada',
    displayName: 'Ada',
    avatarColorKey: 'rose',
    avatarKey: 'av_123e4567-e89b-12d3-a456-426614174000_deadbeef.webp',
    avatarAccent: '#49303f',
    createdAt: 1000,
    presenceStatus: 'away'
  });
  assert.ok(user);
  assert.equal(user.avatarUrl, '/api/avatars/av_123e4567-e89b-12d3-a456-426614174000_deadbeef.webp');
  assert.equal(user.avatarAccent, '#49303f');
  assert.equal(user.presenceStatus, 'away');
  assert.equal(user.doNotDisturb, false);
  assert.equal('avatarKey' in user, false);
});

test('publicUser derives legacy DND flags from the canonical presence status', () => {
  const user = publicUser({ id: 'user-1', login: 'ada', presenceStatus: 'dnd' });
  assert.ok(user);
  assert.equal(user.presenceStatus, 'dnd');
  assert.equal(user.dnd, true);
  assert.equal(user.doNotDisturb, true);
});

test('an avatar is stored with its accent, and a swap returns the key it replaced', { skip }, async (t) => {
  const { store } = await setup(t);
  const { user } = await store.createUser({ login: 'ada', password: 'password123' });
  assert.ok(user);
  const oldKey = `av_${user.id}_0123abcd.webp`;
  const nextKey = `av_${user.id}_deadbeef.webp`;

  const updated = await store.updateAvatar({ userId: user.id, avatarKey: oldKey, avatarAccent: '#49303f', now: 2000 });
  assert.equal(updated?.avatarKey, oldKey);
  assert.equal(updated?.avatarAccent, '#49303f');

  const swapped = await store.swapAvatar({ userId: user.id, avatarKey: nextKey, avatarAccent: '#123456', now: 3000 });
  assert.equal(swapped.previousAvatarKey, oldKey);
  assert.equal(swapped.user?.avatarKey, nextKey);
  assert.equal((await store.getUserById(user.id))?.avatarAccent, '#123456');
  assert.deepEqual(await store.listAvatarKeys(), [nextKey]);

  assert.deepEqual(await store.swapAvatar({ userId: '123e4567-e89b-12d3-a456-426614174000', avatarKey: nextKey }), {
    previousAvatarKey: null,
    user: null
  });
});

test('sessions store only token hashes in the database', { skip }, async (t) => {
  const { pool, store } = await setup(t);
  const { user } = await store.createUser({ login: 'ada', password: 'password123' });
  assert.ok(user);
  const rawToken = 'session-token-for-cookie-only';

  const session = await store.createSession({ userId: user.id, token: rawToken });
  assert.equal(session.token, rawToken);
  const stored = await pool.query<{ id: string }>('SELECT id FROM sessions');
  assert.deepEqual(
    stored.rows.map((row) => row.id),
    [hashSessionToken(rawToken)]
  );
  assert.equal((await store.getSessionUser(rawToken))?.user?.id, user.id);
  assert.equal(await store.deleteSession(rawToken), true);
  assert.equal(await store.getSessionUser(rawToken), null);
});
