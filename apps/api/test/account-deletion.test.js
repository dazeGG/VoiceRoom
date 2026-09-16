'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');

const { createAccountDeletionRepository } = require('../src/domains/account/account-deletion-repository');
const { createUserStore } = require('../src/lib/user-store');
const { runMigrations } = require('../src/lib/migrate');
const { ACCOUNT_DELETION_GRACE_MS, DELETED_ACCOUNT_NAME } = require('@voice-room/shared/account-security');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const DAY = 24 * 60 * 60 * 1000;

async function setup(t) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const pool = new Pool({ connectionString: databaseUrl });
  const users = createUserStore({ databaseUrl, logger: SILENT });
  const deletion = createAccountDeletionRepository({ pool });
  t.after(async () => {
    await users.close();
    await pool.end();
    await cleanup();
  });
  return { pool, users, deletion };
}

async function createRoom(pool, { id, ownerId, name, createdAt }) {
  await pool.query(
    `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name, created_at, updated_at)
     VALUES ($1, '', true, $2, $3, $4, $4)`,
    [id, ownerId, name, new Date(createdAt)]
  );
  await pool.query(
    `INSERT INTO room_memberships (id, room_id, user_id, role, created_at, updated_at)
     VALUES ($1, $2, $3, 'owner', $4, $4)`,
    [crypto.randomUUID(), id, ownerId, new Date(createdAt)]
  );
}

async function addMember(pool, { roomId, userId, joinedAt }) {
  await pool.query(
    `INSERT INTO room_memberships (id, room_id, user_id, role, created_at, updated_at)
     VALUES ($1, $2, $3, 'member', $4, $4)`,
    [crypto.randomUUID(), roomId, userId, new Date(joinedAt)]
  );
}

test('a deletion request hides the account at once and a restore brings it back unchanged', async (t) => {
  const { pool, users, deletion } = await setup(t);
  const { user } = await users.createUser({ login: 'ada', displayName: 'Ада', password: 'lovelace-1843' });
  await pool.query(`UPDATE users SET avatar_key = 'user-ada-avatar', avatar_accent = '#123456' WHERE id = $1`, [user.id]);
  const session = await users.createSession({ userId: user.id, now: 1_000 });
  const now = 10 * DAY;

  assert.deepEqual(await deletion.requestDeletion({ userId: user.id, currentPassword: 'wrong', now }), { status: 'invalid_password' });
  assert.deepEqual(
    await deletion.requestDeletion({ userId: user.id, currentPassword: 'lovelace-1843', now }),
    { status: 'requested', scheduledFor: now + ACCOUNT_DELETION_GRACE_MS }
  );
  assert.equal(await users.getSessionUser(session.token, now + 1), null, 'every session ends');

  const hidden = await users.getUserById(user.id);
  assert.equal(hidden.displayName, DELETED_ACCOUNT_NAME);
  assert.equal(hidden.avatarKey, null);
  assert.equal(hidden.deletionRequestedAt, now);
  assert.ok((await users.listAvatarKeys()).includes('user-ada-avatar'), 'the avatar file is kept for a restore');
  assert.equal((await deletion.requestDeletion({ userId: user.id, currentPassword: 'lovelace-1843', now })).status, 'already_requested');

  assert.deepEqual(await deletion.restoreAccount({ login: 'ada', password: 'wrong', now }), { status: 'invalid', userId: null });
  assert.deepEqual(await deletion.restoreAccount({ login: 'ghost', password: 'lovelace-1843', now }), { status: 'invalid', userId: null });
  assert.deepEqual(await deletion.restoreAccount({ login: 'ada', password: 'lovelace-1843', now: now + DAY }), { status: 'restored', userId: user.id });

  const restored = await users.getUserById(user.id);
  assert.equal(restored.displayName, 'Ада');
  assert.equal(restored.avatarKey, 'user-ada-avatar');
  assert.equal(restored.avatarAccent, '#123456');
  assert.equal(restored.deletionRequestedAt, null);
  assert.deepEqual(await deletion.restoreAccount({ login: 'ada', password: 'lovelace-1843', now }), { status: 'invalid', userId: null });

  await deletion.requestDeletion({ userId: user.id, currentPassword: 'lovelace-1843', now });
  assert.deepEqual(
    await deletion.restoreAccount({ login: 'ada', password: 'lovelace-1843', now: now + ACCOUNT_DELETION_GRACE_MS }),
    { status: 'expired', userId: null }
  );
});

test('finishing a deletion hands rooms to the longest-standing member, removes personal data and keeps conversations', async (t) => {
  const { pool, users, deletion } = await setup(t);
  const { user: ada } = await users.createUser({ login: 'ada', displayName: 'Ада', password: 'lovelace-1843' });
  const { user: grace } = await users.createUser({ login: 'grace', password: 'cobol-1959' });
  const { user: linus } = await users.createUser({ login: 'linus', password: 'kernel-1991' });
  const { user: banned } = await users.createUser({ login: 'mallory', password: 'banned-1234' });
  const start = 100 * DAY;

  await createRoom(pool, { id: 'shared-room', ownerId: ada.id, name: 'Общая', createdAt: start });
  await addMember(pool, { roomId: 'shared-room', userId: banned.id, joinedAt: start + 1 });
  await addMember(pool, { roomId: 'shared-room', userId: linus.id, joinedAt: start + 3 });
  await addMember(pool, { roomId: 'shared-room', userId: grace.id, joinedAt: start + 2 });
  await pool.query(
    `INSERT INTO room_bans (id, room_id, user_id, expires_at, revoked_at) VALUES ($1, 'shared-room', $2, NULL, NULL)`,
    [crypto.randomUUID(), banned.id]
  );
  await createRoom(pool, { id: 'lonely-room', ownerId: ada.id, name: 'Пустая', createdAt: start + 10 });

  const [low, high] = [ada.id, grace.id].sort();
  await pool.query('INSERT INTO friendships (id, user_a_id, user_b_id) VALUES ($1, $2, $3)', [crypto.randomUUID(), low, high]);
  await pool.query(
    `INSERT INTO direct_messages (id, sender_id, recipient_id, body, created_at) VALUES ($1, $2, $3, 'привет', $4)`,
    [crypto.randomUUID(), ada.id, grace.id, new Date(start)]
  );
  await pool.query(
    `INSERT INTO room_messages (id, room_id, peer_id, name, text, created_at, author_user_id)
     VALUES ('ada-message', 'shared-room', $1, 'Ада', 'всем привет', $2, $3)`,
    [ada.id, new Date(start), ada.id]
  );
  await users.generateRecoveryCodes({ userId: ada.id, currentPassword: 'lovelace-1843' });

  const preview = await deletion.previewDeletion({ userId: ada.id, now: start + DAY });
  assert.deepEqual(preview, {
    graceDays: 7,
    rooms: [
      { roomId: 'shared-room', name: 'Общая', heir: { displayName: '', login: 'grace' } },
      { roomId: 'lonely-room', name: 'Пустая', heir: null }
    ]
  });

  const requestedAt = start + DAY;
  await deletion.requestDeletion({ userId: ada.id, currentPassword: 'lovelace-1843', now: requestedAt });
  assert.deepEqual(await deletion.listDueDeletions({ now: requestedAt + ACCOUNT_DELETION_GRACE_MS - 1 }), []);
  assert.deepEqual(await deletion.finalizeDeletion({ userId: ada.id, now: requestedAt + DAY }), { status: 'not_due' });

  const finishAt = requestedAt + ACCOUNT_DELETION_GRACE_MS;
  assert.deepEqual(await deletion.listDueDeletions({ now: finishAt }), [ada.id]);
  const finished = await deletion.finalizeDeletion({ userId: ada.id, now: finishAt });
  assert.deepEqual(finished, {
    status: 'deleted',
    transferredRooms: [{ roomId: 'shared-room', heirUserId: grace.id }],
    deletedRooms: [{ roomId: 'lonely-room', avatarKey: null }],
    avatarKey: null
  });
  assert.deepEqual(await deletion.finalizeDeletion({ userId: ada.id, now: finishAt }), { status: 'not_due' });

  const rooms = await pool.query(`SELECT id, owner_id, deleted_at FROM rooms ORDER BY id`);
  assert.deepEqual(rooms.rows.map((row) => [row.id, row.owner_id, Boolean(row.deleted_at)]), [
    ['lonely-room', ada.id, true],
    ['shared-room', grace.id, false]
  ]);
  const heirRole = await pool.query(`SELECT role FROM room_memberships WHERE room_id = 'shared-room' AND user_id = $1`, [grace.id]);
  assert.equal(heirRole.rows[0].role, 'owner');

  const count = async (sql) => Number((await pool.query(sql, [ada.id])).rows[0].count);
  assert.equal(await count('SELECT count(*) FROM room_memberships WHERE user_id = $1'), 0);
  assert.equal(await count('SELECT count(*) FROM friendships WHERE user_a_id = $1 OR user_b_id = $1'), 0);
  assert.equal(await count('SELECT count(*) FROM account_recovery_codes WHERE user_id = $1'), 0);
  assert.equal(await count('SELECT count(*) FROM direct_messages WHERE sender_id = $1'), 1, 'the other side keeps the conversation');

  const row = (await pool.query('SELECT login, display_name, password_hash, deleted_at FROM users WHERE id = $1', [ada.id])).rows[0];
  assert.match(row.login, /^deleted-[0-9a-f]{24}$/);
  assert.equal(row.display_name, DELETED_ACCOUNT_NAME);
  assert.equal(row.password_hash, '!');
  assert.ok(row.deleted_at);
  assert.equal(await users.verifyCredentials('ada', 'lovelace-1843'), null);
  assert.equal(await deletion.isLoginReserved('ada'), true);
  assert.equal(await deletion.isLoginReserved('ADA '), true);
  assert.equal(await deletion.isLoginReserved('grace'), false);

  // Messages others still read show the anonymous author through the usual join.
  const message = await pool.query(
    `SELECT COALESCE(NULLIF(u.display_name, ''), u.login, m.name) AS author_name
     FROM room_messages m LEFT JOIN users u ON u.id = m.author_user_id WHERE m.id = 'ada-message'`
  );
  assert.equal(message.rows[0].author_name, DELETED_ACCOUNT_NAME);
});
