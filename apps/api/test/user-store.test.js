'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createUserStore, publicUser } = require('../src/lib/user-store');
const { AVATAR_COLOR_KEYS } = require('@voice-room/shared/validation');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

async function createMigratedStore(t, options = {}) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const store = createUserStore({ databaseUrl, logger: SILENT, ...options });
  t.after(async () => {
    await store.close();
    await cleanup();
  });
  return store;
}

test('createUser persists a hashed account and rejects duplicate logins', async (t) => {
  const store = await createMigratedStore(t);

  const created = await store.createUser({ login: 'vovosh', displayName: 'Вова', password: 'password123' });
  assert.equal(created.status, 'created');
  assert.equal(created.user.login, 'vovosh');
  assert.equal(created.user.displayName, 'Вова');
  assert.ok(created.user.id);
  assert.ok(AVATAR_COLOR_KEYS.includes(created.user.avatarColorKey));

  const duplicate = await store.createUser({ login: 'vovosh', password: 'another-password' });
  assert.equal(duplicate.status, 'login_taken');
  assert.equal(duplicate.user, null);
});

test('verifyCredentials authenticates only with the correct password', async (t) => {
  const store = await createMigratedStore(t);
  await store.createUser({ login: 'ada', password: 'lovelace-1843' });

  assert.ok(await store.verifyCredentials('ada', 'lovelace-1843'));
  assert.equal(await store.verifyCredentials('ada', 'wrong'), null);
  assert.equal(await store.verifyCredentials('ghost', 'whatever'), null);
});

test('sessions resolve to their user and expire', async (t) => {
  const store = await createMigratedStore(t, { sessionTtlMs: 1000 });
  const { user } = await store.createUser({ login: 'grace', password: 'cobol-1959' });

  const session = await store.createSession({ userId: user.id, now: 1000 });
  const resolved = await store.getSessionUser(session.token, 1500);
  assert.equal(resolved.user.id, user.id);
  assert.equal(resolved.user.login, 'grace');
  assert.ok(AVATAR_COLOR_KEYS.includes(resolved.user.avatarColorKey));

  const expired = await store.getSessionUser(session.token, 5000);
  assert.equal(expired, null);
});

test('deleteSession and pruneSessions remove session rows', async (t) => {
  const store = await createMigratedStore(t, { sessionTtlMs: 1000 });
  const { user } = await store.createUser({ login: 'linus', password: 'kernel-1991' });

  const active = await store.createSession({ userId: user.id, now: 2000 });
  assert.equal(await store.deleteSession(active.token), true);
  assert.equal(await store.getSessionUser(active.token, 2500), null);

  await store.createSession({ userId: user.id, now: 1000 });
  assert.equal(await store.pruneSessions(5000), 1);
});

test('publicUser never leaks the password hash', async (t) => {
  const store = await createMigratedStore(t);
  const { user } = await store.createUser({ login: 'safe', password: 'no-leak-please' });
  const exposed = publicUser(user);
  assert.equal('passwordHash' in exposed, false);
  assert.deepEqual(Object.keys(exposed).sort(), ['avatarColorKey', 'createdAt', 'displayName', 'id', 'login']);
  assert.ok(AVATAR_COLOR_KEYS.includes(exposed.avatarColorKey));
});


test('createUser accepts a valid injected avatar color for deterministic callers', async (t) => {
  const store = await createMigratedStore(t);
  const { user } = await store.createUser({ login: 'colorful', avatarColorKey: 'rose', password: 'password123' });
  assert.equal(user.avatarColorKey, 'rose');
  assert.equal(publicUser(user).avatarColorKey, 'rose');
});
