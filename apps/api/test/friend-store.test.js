'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createFriendStore, orderedPair } = require('../src/lib/friend-store');
const { createUserStore } = require('../src/lib/user-store');
const { runMigrations } = require('../src/lib/migrate');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };

async function createStores(t) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const users = createUserStore({ databaseUrl, logger: SILENT });
  const friends = createFriendStore({ databaseUrl, logger: SILENT });
  t.after(async () => {
    await friends.close();
    await users.close();
    await cleanup();
  });
  return { users, friends };
}

async function makeUser(users, login) {
  const created = await users.createUser({ login, displayName: login, password: 'password123' });
  assert.equal(created.status, 'created', `created ${login}`);
  return created.user;
}

test('orderedPair is canonical regardless of argument order', () => {
  assert.deepEqual(orderedPair('b', 'a'), ['a', 'b']);
  assert.deepEqual(orderedPair('a', 'b'), ['a', 'b']);
});

test('sendRequest creates a pending request and lists it both ways', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');

  const sent = await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' });
  assert.equal(sent.status, 'sent');
  assert.equal(sent.user.id, bob.id);

  const bobReqs = await friends.listRequests(bob.id);
  assert.equal(bobReqs.incoming.length, 1);
  assert.equal(bobReqs.incoming[0].user.id, alice.id);
  assert.equal(bobReqs.outgoing.length, 0);

  const aliceReqs = await friends.listRequests(alice.id);
  assert.equal(aliceReqs.outgoing.length, 1);
  assert.equal(aliceReqs.outgoing[0].user.id, bob.id);
  assert.equal(await friends.countIncomingRequests(bob.id), 1);

  // Not friends yet.
  assert.equal(await friends.areFriends(alice.id, bob.id), false);
});

test('sendRequest is idempotent and rejects self/missing targets', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  await makeUser(users, 'bob');

  assert.equal((await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'alice' })).status, 'self');
  assert.equal((await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'ghost' })).status, 'not_found');

  await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' });
  assert.equal((await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' })).status, 'already_sent');
});

test('concurrent duplicate sendRequest does not throw and stays idempotent', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  await makeUser(users, 'bob');

  // Race two sends for the same pair: the partial unique index would raise a
  // 23505 without ON CONFLICT. Neither call should throw.
  const [a, b] = await Promise.all([
    friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' }),
    friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' })
  ]);

  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, ['already_sent', 'sent']);

  // Exactly one pending request survived.
  const bobReqs = await friends.listRequests(alice.id);
  assert.equal(bobReqs.outgoing.length, 1);
});

test('reverse request auto-accepts into a friendship', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');

  await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' });
  const reverse = await friends.sendRequest({ requesterId: bob.id, addresseeLogin: 'alice' });
  assert.equal(reverse.status, 'accepted');

  assert.equal(await friends.areFriends(alice.id, bob.id), true);
  assert.equal((await friends.listRequests(alice.id)).outgoing.length, 0);
  assert.equal((await friends.listFriends(alice.id)).length, 1);
});

test('accept turns a request into a mutual friendship', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');

  const sent = await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' });
  const accepted = await friends.respondRequest({ userId: bob.id, requestId: sent.requestId, action: 'accept' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.requesterId, alice.id);

  assert.equal(await friends.areFriends(alice.id, bob.id), true);
  const aliceFriends = await friends.listFriends(alice.id);
  assert.equal(aliceFriends.length, 1);
  assert.equal(aliceFriends[0].user.id, bob.id);
});

test('listRequests surfaces the request id (not the joined user id) so accept works', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');

  const sent = await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' });

  // Regression: `u.*` in the SELECT also exposes `id`, and duplicate column
  // names make node-postgres keep the last one — so `row.id` used to be the
  // requester's user id, breaking accept/decline ("Заявка не найдена").
  const incoming = (await friends.listRequests(bob.id)).incoming[0];
  assert.equal(incoming.id, sent.requestId);
  assert.notEqual(incoming.id, alice.id);

  const outgoing = (await friends.listRequests(alice.id)).outgoing[0];
  assert.equal(outgoing.id, sent.requestId);
  assert.notEqual(outgoing.id, bob.id);

  // Accepting with the id the client actually has (from listRequests) succeeds.
  const accepted = await friends.respondRequest({ userId: bob.id, requestId: incoming.id, action: 'accept' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(await friends.areFriends(alice.id, bob.id), true);
});

test('decline and cancel leave no friendship', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');

  const sent = await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' });
  const declined = await friends.respondRequest({ userId: bob.id, requestId: sent.requestId, action: 'decline' });
  assert.equal(declined.status, 'declined');
  assert.equal(await friends.areFriends(alice.id, bob.id), false);

  const resent = await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' });
  const cancelled = await friends.cancelRequest({ userId: alice.id, requestId: resent.requestId });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.addresseeId, bob.id);
  assert.equal(await friends.countIncomingRequests(bob.id), 0);
});

test('respond/cancel reject requests the user does not own', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');
  const eve = await makeUser(users, 'eve');

  const sent = await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' });
  // Eve can neither accept (not addressee) nor cancel (not requester).
  assert.equal((await friends.respondRequest({ userId: eve.id, requestId: sent.requestId, action: 'accept' })).status, 'not_found');
  assert.equal((await friends.cancelRequest({ userId: eve.id, requestId: sent.requestId })).status, 'not_found');
});

test('removeFriend deletes the friendship for both sides', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');

  const sent = await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' });
  await friends.respondRequest({ userId: bob.id, requestId: sent.requestId, action: 'accept' });

  const removed = await friends.removeFriend({ userId: bob.id, friendId: alice.id });
  assert.equal(removed.status, 'removed');
  assert.equal(await friends.areFriends(alice.id, bob.id), false);
  assert.equal((await friends.removeFriend({ userId: bob.id, friendId: alice.id })).status, 'not_found');
});

test('direct messages thread, unread counts, and read receipts', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  const bob = await makeUser(users, 'bob');

  const sent = await friends.sendRequest({ requesterId: alice.id, addresseeLogin: 'bob' });
  await friends.respondRequest({ userId: bob.id, requestId: sent.requestId, action: 'accept' });

  await friends.sendMessage({ senderId: alice.id, recipientId: bob.id, body: 'привет' });
  await friends.sendMessage({ senderId: alice.id, recipientId: bob.id, body: 'как дела?' });
  await friends.sendMessage({ senderId: bob.id, recipientId: alice.id, body: 'норм' });

  const thread = await friends.listThread({ userId: bob.id, peerId: alice.id });
  assert.equal(thread.length, 3);
  assert.deepEqual(thread.map((m) => m.body), ['привет', 'как дела?', 'норм']);

  // Bob has 2 unread from alice.
  assert.equal((await friends.getUnreadCounts(bob.id))[alice.id], 2);
  const bobFriends = await friends.listFriends(bob.id);
  assert.equal(bobFriends[0].unreadCount, 2);
  assert.equal(bobFriends[0].lastMessage.body, 'норм');
  assert.equal(bobFriends[0].lastMessage.fromMe, true);

  const read = await friends.markRead({ userId: bob.id, peerId: alice.id });
  assert.equal(read.count, 2);
  assert.equal((await friends.getUnreadCounts(bob.id))[alice.id], undefined);
});

test('searchUsers matches login and display name, excludes self', async (t) => {
  const { users, friends } = await createStores(t);
  const alice = await makeUser(users, 'alice');
  await makeUser(users, 'alicia');
  await makeUser(users, 'bob');

  const results = await friends.searchUsers({ query: 'ali', excludeUserId: alice.id });
  const logins = results.map((u) => u.login).sort();
  assert.deepEqual(logins, ['alicia']);
});
