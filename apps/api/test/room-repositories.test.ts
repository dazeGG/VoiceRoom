// The room store over a migrated database: rooms under quota, avatars, chat
// messages and their authors, read cursors and unread counts, recipients and
// guest identities.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRoomStore } from '../src/lib/room-store.ts';
import { createUserStore } from '../src/lib/user-store.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { mapRoom } from '../src/domains/rooms/room.repository.ts';
import { createTestDatabase } from './db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const skip = !process.env.TEST_DATABASE_URL;

async function setup(t: TestContext) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const store = createRoomStore({ pool });
  const users = createUserStore({ pool, logger: SILENT });
  async function user(login: string, displayName = '') {
    const { user: created } = await users.createUser({ login, displayName, password: 'password123' });
    assert.ok(created);
    return created;
  }
  async function room(roomId: string, input: Partial<Parameters<typeof store.createRoom>[0]> = {}) {
    const created = await store.createRoom({ roomId, isStatic: true, now: 1000, ...input });
    assert.ok(created);
    return created;
  }
  return { pool, store, user, room };
}

test('mapRoom turns a room row into the API room shape', () => {
  const room = mapRoom({
    avatar_key: 'room_abcdefghij_deadbeef.webp',
    id: 'abc123',
    creator_ip: '127.0.0.1',
    is_static: true,
    created_at: new Date(1000),
    updated_at: new Date(2000),
    empty_since: null,
    deleted_at: null,
    emoji: '🦄',
    metadata: {},
    name: '',
    owner_id: null,
    room_color_key: '',
    room_icon_key: ''
  });
  assert.deepEqual(room, {
    avatarKey: 'room_abcdefghij_deadbeef.webp',
    createdAt: 1000,
    creatorIp: '127.0.0.1',
    emptySince: null,
    id: 'abc123',
    isStatic: true,
    lastMessageAt: undefined,
    name: '',
    ownerId: null,
    unreadCount: undefined,
    updatedAt: 2000
  });
});

test('a created room reads back; avatars change only on live static rooms', { skip }, async (t) => {
  const { store, room } = await setup(t);
  const created = await room('room1', { creatorIp: 'ip', name: 'Кухня' });
  assert.deepEqual(
    [created.id, created.creatorIp, created.isStatic, created.name, created.emptySince],
    ['room1', 'ip', true, 'Кухня', 1000]
  );
  assert.deepEqual(await store.getRoom('room1'), created);
  assert.equal(await store.roomIdExists('room1'), true);
  assert.equal(await store.roomIdExists('nope'), false);

  const withAvatar = await store.updateRoomAvatar('room1', 'room_room1_aaaa.webp', 2000);
  assert.equal(withAvatar?.avatarKey, 'room_room1_aaaa.webp');
  assert.equal(withAvatar?.updatedAt, 2000);
  const swapped = await store.swapRoomAvatar('room1', 'room_room1_bbbb.webp', 3000);
  assert.equal(swapped.previousAvatarKey, 'room_room1_aaaa.webp');
  assert.equal(swapped.room?.avatarKey, 'room_room1_bbbb.webp');
  assert.deepEqual(await store.listAvatarKeys(), ['room_room1_bbbb.webp']);

  await store.createRoom({ roomId: 'temp', isStatic: false });
  assert.equal(await store.updateRoomAvatar('temp', 'room_temp_aaaa.webp'), null, 'temporary rooms have no avatar');
  assert.deepEqual(await store.swapRoomAvatar('temp', 'room_temp_aaaa.webp'), { previousAvatarKey: null, room: null });

  assert.equal((await store.deleteRoom('room1', 4000))?.id, 'room1');
  assert.equal(await store.getRoom('room1'), null);
  assert.equal(await store.updateRoomAvatar('room1', 'room_room1_cccc.webp'), null, 'deleted rooms stay as they were');
  assert.deepEqual(await store.listAvatarKeys(), []);
});

test('room creation checks the owner, the per-owner and per-address quotas and the capacity', { skip }, async (t) => {
  const { pool, store, user } = await setup(t);
  const owner = await user('owner');

  assert.deepEqual(await store.createRoomWithQuota({ roomId: 'anon', isStatic: true, maxRooms: 10 }), {
    room: null,
    status: 'auth_required'
  });

  for (const roomId of ['s1', 's2']) {
    const created = await store.createRoomWithQuota({
      roomId,
      isStatic: true,
      ownerId: owner.id,
      maxOwnedStaticRoomsPerUser: 2,
      maxRooms: 10
    });
    assert.equal(created.status, 'created');
    assert.equal(created.room?.ownerId, owner.id);
  }
  const memberships = await pool.query(
    'SELECT room_id, role FROM room_memberships WHERE user_id = $1 ORDER BY room_id',
    [owner.id]
  );
  assert.deepEqual(memberships.rows, [
    { room_id: 's1', role: 'owner' },
    { room_id: 's2', role: 'owner' }
  ]);
  assert.equal(await store.countOwnedStaticRoomsForUser(owner.id), 2);
  assert.deepEqual(
    await store.createRoomWithQuota({
      roomId: 's3',
      isStatic: true,
      ownerId: owner.id,
      maxOwnedStaticRoomsPerUser: 2,
      maxRooms: 10
    }),
    { room: null, status: 'quota_exceeded' }
  );

  assert.equal(
    (await store.createRoomWithQuota({ roomId: 't1', creatorIp: 'ip', maxTempRoomsPerIp: 1 })).status,
    'created'
  );
  assert.deepEqual(await store.createRoomWithQuota({ roomId: 't2', creatorIp: 'ip', maxTempRoomsPerIp: 1 }), {
    room: null,
    status: 'quota_exceeded'
  });
  assert.equal(await store.countQuotaRoomsForIp('ip'), 1);

  assert.equal(await store.countRooms(), 3);
  assert.deepEqual(await store.createRoomWithQuota({ roomId: 't3', creatorIp: 'other', maxRooms: 3 }), {
    room: null,
    status: 'capacity_exceeded'
  });
  assert.equal(await store.getRoom('t3'), null, 'a refused room is not written');
});

test('a message never expires, shows its author as they are now, and edits in place', { skip }, async (t) => {
  const { pool, store, user, room } = await setup(t);
  await room('room1');
  const ada = await user('ada', 'Ада');

  assert.equal(await store.appendMessage('missing', { text: 'hi' }), null, 'no message in a missing room');

  const guest = await store.appendMessage(
    'room1',
    { id: 'm1', peerId: 'peer1', name: 'Гость', text: 'hello', createdAt: 1000, expiresAt: 2000 } as never,
    1000
  );
  assert.equal(guest?.expiresAt, null, 'a requested expiry is ignored');
  assert.equal(guest?.name, 'Гость');

  const own = await store.appendMessage(
    'room1',
    { id: 'm2', peerId: 'peer2', name: 'Outdated profile', text: 'hi', createdAt: 2000, authorUserId: ada.id },
    2000
  );
  assert.equal(own?.authorUserId, ada.id);
  const stored = await pool.query<{ name: string }>('SELECT name FROM room_messages WHERE id = $1', ['m2']);
  assert.equal(stored.rows[0]?.name, '', 'no profile-name snapshot for account messages');

  await pool.query('UPDATE users SET display_name = $2 WHERE id = $1', [ada.id, 'Ада Л.']);
  const listed = await store.listMessages('room1', { now: 3000 });
  assert.deepEqual(
    listed.map((message) => [message.id, message.name, message.text]),
    [
      ['m1', 'Гость', 'hello'],
      ['m2', 'Ада Л.', 'hi']
    ]
  );
  assert.equal((await store.getMessage('room1', 'm2'))?.name, 'Ада Л.');

  const edited = await store.editMessage('room1', 'm1', 'updated');
  assert.equal(edited?.text, 'updated');
  assert.ok(edited?.editedAt);
  assert.equal(await store.softDeleteMessage('room1', 'm1'), true);
  assert.equal(await store.softDeleteMessage('room1', 'm1'), false);
  assert.equal(await store.editMessage('room1', 'm1', 'again'), null, 'a deleted message is not edited');
  assert.equal(await store.getMessage('room1', 'm1'), null);
  assert.deepEqual(
    (await store.listMessages('room1')).map((message) => message.id),
    ['m2']
  );
  assert.equal(
    (await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM room_messages')).rows[0]?.count,
    2,
    'nothing is trimmed'
  );
});

test('appendMessage runs the unit of work in its transaction and rolls back with it', { skip }, async (t) => {
  const { pool, store, room } = await setup(t);
  await room('room1');
  await assert.rejects(
    store.appendMessage('room1', {
      id: 'doomed',
      text: 'x',
      async unitOfWork(client, message) {
        const seen = await client.query('SELECT id FROM room_messages WHERE id = $1', [message.id]);
        assert.equal(seen.rowCount, 1, 'the unit of work sees the message on the same connection');
        throw new Error('outbox failed');
      }
    }),
    /outbox failed/
  );
  assert.equal(
    (await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM room_messages')).rows[0]?.count,
    0
  );

  const replay = await store.appendMessage('room1', {
    text: 'x',
    beforeUnitOfWork: async () => ({ replay: true, message: { id: 'earlier', text: 'x' } })
  });
  assert.deepEqual(replay, { id: 'earlier', text: 'x', idempotencyReplay: true });
});

test('unread counts start after the read cursor or the join, and never count your own', { skip }, async (t) => {
  const { store, user, room } = await setup(t);
  const owner = await user('owner');
  const reader = await user('reader');
  await store.createRoomWithQuota({ roomId: 'room1', isStatic: true, ownerId: owner.id, now: 1000 });
  await room('other');

  await store.appendMessage('room1', { text: 'before join', authorUserId: owner.id, createdAt: 1500 }, 1500);
  await store.addRoomBookmarkForUser(reader.id, 'room1', 2000);
  for (const at of [3000, 4000])
    await store.appendMessage('room1', { text: 'x', authorUserId: owner.id, createdAt: at }, at);
  await store.appendMessage('room1', { text: 'mine', authorUserId: reader.id, createdAt: 4500 }, 4500);

  assert.equal(await store.getRoomUnreadCount('room1', reader.id, 5000), 2);
  assert.equal(await store.markRoomChatRead('room1', reader.id, 3500), 3500);
  assert.equal(await store.markRoomChatRead('room1', reader.id, 3000), 3500, 'the cursor never moves back');
  assert.equal(await store.getRoomUnreadCount('room1', reader.id, 5000), 1);
  assert.equal(await store.markRoomChatRead('other', reader.id, 5000), null, 'no cursor for a room not in the list');

  const [visible] = await store.listVisibleRoomsForUser(reader.id);
  assert.equal(visible?.id, 'room1');
  assert.equal(visible?.relationship, 'bookmarked');
  assert.equal(visible?.unreadCount, 1);
  assert.equal(visible?.lastMessageAt, 4500);
  const [owned] = await store.listVisibleRoomsForUser(owner.id);
  assert.equal(owned?.relationship, 'owner');
  assert.equal(owned?.unreadCount, 1, "the reader's message is unread for the owner");
});

test('room lists and recipients: owner, bookmarks, members, and legacy mutes ignored', { skip }, async (t) => {
  const { pool, store, user } = await setup(t);
  const owner = await user('owner');
  const fan = await user('fan');
  const member = await user('member');
  await store.createRoomWithQuota({ roomId: 'room1', isStatic: true, ownerId: owner.id });
  await store.addRoomBookmarkForUser(fan.id, 'room1');
  await pool.query(`INSERT INTO room_memberships (id, room_id, user_id, role) VALUES ('m-1', 'room1', $1, 'member')`, [
    member.id
  ]);
  await pool.query(`INSERT INTO notification_room_mutes (id, user_id, room_id) VALUES ('mute-1', $1, 'room1')`, [
    fan.id
  ]);

  assert.deepEqual(
    new Set(await store.listNotificationRecipientUserIds('room1')),
    new Set([owner.id, fan.id, member.id])
  );
  assert.deepEqual(new Set(await store.listSummaryRecipientUserIds('room1')), new Set([owner.id, fan.id]));
  assert.equal(await store.canUserReadRoomChat('room1', member.id), true);
  assert.equal(await store.canUserReactInRoom('room1', fan.id), true, 'a bookmark makes you a member');

  assert.deepEqual(await store.removeRoomBookmarkForUser(owner.id, 'room1'), { removed: false, status: 'owner' });
  assert.deepEqual(await store.removeRoomBookmarkForUser(fan.id, 'room1'), { removed: true, status: 'removed' });
  assert.equal(await store.canUserReadRoomChat('room1', fan.id), false);
  assert.deepEqual(
    (await store.listRoomsForOwner(owner.id)).map((room) => room.id),
    ['room1']
  );
});

test('a guest identity is created, reused with its token, and refused with another', { skip }, async (t) => {
  const { store, room } = await setup(t);
  await room('room1');

  const created = await store.getOrCreatePeerIdentity({
    roomId: 'room1',
    peerId: 'peer123456',
    sessionToken: 'token-a',
    displayName: 'Ada',
    avatarColorKey: 'green',
    now: 1000
  });
  assert.equal(created?.status, 'created');
  assert.equal(created?.identity?.avatarColorKey, 'green');
  assert.notEqual(created?.identity?.sessionTokenHash, 'token-a', 'only the hash is kept');

  const reused = await store.getOrCreatePeerIdentity({
    roomId: 'room1',
    peerId: 'peer123456',
    sessionToken: 'token-a',
    displayName: 'Ada 2',
    avatarColorKey: 'rose',
    now: 2000
  });
  assert.equal(reused?.status, 'reused');
  assert.equal(reused?.identity?.avatarColorKey, 'rose');
  assert.equal(reused?.identity?.displayName, 'Ada 2');

  const kept = await store.getOrCreatePeerIdentity({ roomId: 'room1', peerId: 'peer123456', sessionToken: 'token-a' });
  assert.equal(kept?.identity?.avatarColorKey, 'rose', 'no colour asked, the chosen one stays');

  const mismatch = await store.getOrCreatePeerIdentity({
    roomId: 'room1',
    peerId: 'peer123456',
    sessionToken: 'token-b'
  });
  assert.equal(mismatch?.status, 'token_mismatch');
});

test('two first joins with one token race to one identity', { skip }, async (t) => {
  const { store, room } = await setup(t);
  await room('room-race');
  const claim = () =>
    store.getOrCreatePeerIdentity({ roomId: 'room-race', peerId: 'peer123456', sessionToken: 'token-a' });
  const results = await Promise.all([claim(), claim(), claim()]);
  assert.deepEqual(results.map((result) => result?.status).sort(), ['created', 'reused', 'reused']);
  assert.equal(new Set(results.map((result) => result?.identity?.id)).size, 1);
});

test('adding a room to the list makes a member, except for the owner and for someone banned', { skip }, async (t) => {
  const { pool, store, user } = await setup(t);
  const owner = await user('owner');
  const fan = await user('fan');
  const banned = await user('banned');
  await store.createRoomWithQuota({ roomId: 'room1', isStatic: true, ownerId: owner.id });
  await store.createRoom({ roomId: 'temp', isStatic: false });
  await store.createRoomBan({ roomId: 'room1', userId: banned.id });
  const roles = async (userId: string) =>
    (
      await pool.query<{ role: string }>('SELECT role FROM room_memberships WHERE room_id = $1 AND user_id = $2', [
        'room1',
        userId
      ])
    ).rows;
  const bookmarks = async (userId: string) =>
    (await pool.query('SELECT 1 FROM room_bookmarks WHERE room_id = $1 AND user_id = $2', ['room1', userId])).rowCount;

  const added = await store.addRoomBookmarkForUser(fan.id, 'room1');
  assert.equal(added.status, 'bookmarked');
  assert.equal(added.room?.relationship, 'bookmarked');
  assert.deepEqual(await roles(fan.id), [{ role: 'member' }]);

  const own = await store.addRoomBookmarkForUser(owner.id, 'room1');
  assert.equal(own.room?.relationship, 'owner');
  assert.deepEqual(await roles(owner.id), [{ role: 'owner' }], 'no extra member row for the owner');

  assert.equal((await store.addRoomBookmarkForUser(banned.id, 'room1')).status, 'bookmarked');
  assert.equal(await bookmarks(banned.id), 1, 'the list entry is kept');
  assert.deepEqual(await roles(banned.id), [], 'but a banned user does not become a member');

  assert.deepEqual(await store.addRoomBookmarkForUser(fan.id, 'temp'), { room: null, status: 'temporary_room' });
  assert.deepEqual(await store.addRoomBookmarkForUser(fan.id, 'missing'), { room: null, status: 'not_found' });

  await store.removeRoomBookmarkForUser(fan.id, 'room1');
  assert.deepEqual(await roles(fan.id), [], 'leaving the list ends the membership');
  assert.deepEqual(await roles(owner.id), [{ role: 'owner' }]);
});
