import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { sql } from 'kysely';
import { Pool } from 'pg';
import { SignedIn } from '@voiceroom/shared/contracts/account';
import { DirectHistoryPage, DirectMessageAnswer, DirectThread } from '@voiceroom/shared/contracts/messages';
import { PrivacyResponse, type PrivacySettings } from '@voiceroom/shared/contracts/privacy';
import { RoomCreated } from '@voiceroom/shared/contracts/rooms';
import { FriendSearch } from '@voiceroom/shared/contracts/social';
import { kyselyOn, withTransaction } from '../../../src/platform/db/kysely.ts';
import { lockUserPair } from '../../../src/domains/social/social-records.ts';
import {
  acceptFirstFriendRequest,
  cookieFrom,
  request,
  sendFriendRequest,
  startApiServer
} from '../../fakes/server-process.ts';
import { countWsType, openWs, waitForWsType } from '../../ws-harness.ts';

type Account = { id: string; cookie: string };

async function setup(t: TestContext) {
  const { socketPath, logs, databaseUrl, beforeCleanup } = await startApiServer(t, {
    env: { AUTH_RATE_LIMIT: '0', DM_RATE_LIMIT: '0', VOICE_CALLS_ENABLED: 'true' }
  });
  async function account(login: string): Promise<Account> {
    const response = await request(
      socketPath,
      {
        method: 'POST',
        pathname: '/api/auth/register',
        body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
      },
      SignedIn
    );
    assert.equal(response.status, 201);
    return { id: response.body.user.id, cookie: cookieFrom(response.setCookie) };
  }
  const url = (peer: Account) => `/api/dm/${peer.id}`;
  const settings = (owner: Account, body: PrivacySettings) =>
    request(socketPath, { method: 'PUT', pathname: '/api/privacy', cookie: owner.cookie, body }, PrivacyResponse);
  async function send(from: Account, to: Account, text = 'Hello', idempotencyKey?: string) {
    const response = await request(socketPath, {
      method: 'POST',
      pathname: url(to),
      cookie: from.cookie,
      body: { text, idempotencyKey }
    });
    assert.ok(
      response.status < 500,
      `${response.status} from DM send\n${logs.stderr}\n${logs.stdout.split('\n').slice(-6).join('\n')}`
    );
    return response;
  }
  return { socketPath, account, url, settings, send, databaseUrl, beforeCleanup };
}

test('privacy routes control open, history, send, search and room invitations in both directions', async (t) => {
  const lab = await setup(t);
  const { socketPath } = lab;
  const [alice, bob] = await Promise.all([lab.account('alice'), lab.account('bob')]);
  const allow = (method: 'PUT' | 'DELETE', kind: 'calls' | 'messages') =>
    request(
      socketPath,
      {
        method,
        pathname: `/api/privacy/allow/${kind}/${alice.id}`,
        cookie: bob.cookie
      },
      PrivacyResponse
    );
  const thread = () => ({ pathname: lab.url(bob), cookie: alice.cookie });
  const history = () => ({ ...thread(), pathname: `${lab.url(bob)}/history` });
  assert.equal((await request(socketPath, { pathname: '/api/privacy' })).status, 401);
  assert.deepEqual(
    (await request(socketPath, { pathname: '/api/privacy', cookie: bob.cookie }, PrivacyResponse)).body.privacy,
    {
      messagesFrom: 'everyone',
      callsFrom: 'friends',
      allowList: []
    }
  );
  assert.equal((await request(socketPath, thread(), DirectThread)).body.isFriend, false);
  assert.equal((await request(socketPath, thread(), DirectThread)).body.canMessage, true);
  assert.equal((await lab.settings(bob, { messagesFrom: 'friends', callsFrom: 'selected' })).status, 200);
  assert.equal((await request(socketPath, thread())).body.code, 'messages_closed');
  const deniedHistory = await request(socketPath, history());
  assert.equal(deniedHistory.status, 403);
  assert.equal(deniedHistory.body.code, 'thread_forbidden');
  assert.equal(deniedHistory.body.messageReason, 'friends_only');
  assert.equal((await lab.send(alice, bob)).body.code, 'messages_closed');
  const search = await request(
    socketPath,
    { pathname: '/api/friends/search?q=bob', cookie: alice.cookie },
    FriendSearch
  );
  assert.equal(search.body.results[0]?.messageReason, 'friends_only');
  assert.equal((await lab.settings(bob, { messagesFrom: 'selected', callsFrom: 'selected' })).status, 200);
  assert.equal((await allow('PUT', 'messages')).body.privacy.allowList[0]?.user.id, alice.id);
  assert.equal((await lab.send(alice, bob)).status, 201);

  const room = await request(
    socketPath,
    { method: 'POST', pathname: '/api/rooms', cookie: alice.cookie, body: { isStatic: true, name: 'Privacy room' } },
    RoomCreated
  );
  const ring = (from: Account, to: Account) =>
    request(socketPath, {
      method: 'POST',
      pathname: `/api/rooms/${room.body.roomId}/ring`,
      cookie: from.cookie,
      body: { userId: to.id }
    });
  assert.equal((await ring(alice, bob)).body.code, 'calls_closed');
  assert.equal((await allow('PUT', 'calls')).body.privacy.allowList.length, 2);
  assert.equal((await ring(alice, bob)).status, 200);
  assert.equal((await allow('DELETE', 'messages')).body.privacy.allowList.length, 1);
  assert.equal((await request(socketPath, thread(), DirectThread)).body.messageReason, 'not_selected');
  assert.equal((await request(socketPath, history(), DirectHistoryPage)).body.contact?.canMessage, false);

  const blocked = await request(socketPath, { method: 'PUT', pathname: `/api/blocks/${alice.id}`, cookie: bob.cookie });
  assert.equal(blocked.status, 200);
  for (const [from, to] of [
    [alice, bob],
    [bob, alice]
  ] as const) {
    assert.equal((await lab.send(from, to)).body.code, 'relationship_blocked');
    assert.equal((await ring(from, to)).body.code, 'relationship_blocked');
  }
  const preserved = await request(socketPath, history(), DirectHistoryPage);
  assert.equal(preserved.body.contact?.messageReason, 'blocked');
  assert.ok(preserved.body.messages.length >= 1);
});

test('stranger caps enforce 3/4 unanswered and 10/11 new pairs, even for concurrent writers', async (t) => {
  const lab = await setup(t);
  const alice = await lab.account('alice');
  const peers = await Promise.all(Array.from({ length: 11 }, (_, index) => lab.account(`peer${index}`)));
  const [bob, ...others] = peers;
  assert.ok(bob);
  assert.equal((await lab.send(alice, bob)).status, 201);
  assert.equal((await lab.send(alice, bob)).status, 201);
  const key = randomUUID();
  const original = await lab.send(alice, bob, 'Third', key);
  assert.equal(original.status, 201);
  assert.equal((await lab.send(alice, bob)).body.code, 'unanswered_cap_reached');
  const replay = await lab.send(alice, bob, 'Third', key);
  assert.equal(replay.status, 201, 'a retry is not a fourth message');
  const { message: originalMessage } = original.body;
  const { message: replayMessage } = replay.body;
  assert.ok(
    originalMessage && replayMessage && typeof originalMessage === 'object' && typeof replayMessage === 'object'
  );
  assert.ok('id' in originalMessage && 'id' in replayMessage);
  assert.equal(replayMessage.id, originalMessage.id);
  assert.equal((await lab.send(bob, alice, 'Reply')).status, 201);
  assert.equal((await lab.send(alice, bob, 'After reply')).status, 201);
  const results = await Promise.all(others.map((peer) => lab.send(alice, peer)));
  assert.equal(results.filter(({ status }) => status === 201).length, 9);
  assert.deepEqual(
    results.filter(({ status }) => status !== 201).map(({ body }) => body.code),
    ['chat_cap_reached']
  );
  const existing = await request(
    lab.socketPath,
    { method: 'POST', pathname: lab.url(bob), cookie: alice.cookie, body: { text: 'Existing pair' } },
    DirectMessageAnswer
  );
  assert.equal(existing.status, 201);
});

test('allow-list routes validate inputs and scope all changes to the session owner', async (t) => {
  const lab = await setup(t);
  const [alice, bob, carol] = await Promise.all([lab.account('alice'), lab.account('bob'), lab.account('carol')]);
  const allow = (owner: Account, method: 'PUT' | 'DELETE', kind: string, id: string) =>
    request(lab.socketPath, { method, pathname: `/api/privacy/allow/${kind}/${id}`, cookie: owner.cookie });

  for (const method of ['PUT', 'DELETE'] as const) {
    const malformed = await allow(alice, method, 'messages', 'not-a-uuid');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.code, 'invalid_request');
    assert.equal(malformed.body.error, 'Invalid request');
  }
  assert.equal((await allow(alice, 'PUT', 'messages', randomUUID())).status, 404);
  assert.equal((await allow(alice, 'PUT', 'messages', alice.id)).status, 404);
  assert.equal((await allow(alice, 'PUT', 'invalid', bob.id)).status, 400);
  assert.equal((await allow(alice, 'PUT', 'messages', bob.id)).status, 200);
  assert.equal((await allow(carol, 'PUT', 'messages', bob.id)).status, 200);
  assert.equal((await allow(alice, 'DELETE', 'messages', bob.id)).status, 200);
  assert.equal((await allow(alice, 'DELETE', 'messages', bob.id)).status, 200);

  for (const [owner, ids] of [
    [alice, []],
    [carol, [bob.id]]
  ] as const) {
    const { body } = await request(lab.socketPath, { pathname: '/api/privacy', cookie: owner.cookie }, PrivacyResponse);
    assert.deepEqual(
      body.privacy.allowList.map((entry) => entry.user.id),
      ids
    );
  }
});

test('a closed or blocked thread refuses content edits without changing history or sending an edit event', async (t) => {
  const lab = await setup(t);
  const [alice, bob] = await Promise.all([lab.account('alice'), lab.account('bob')]);
  const sockets = [alice, bob].map(({ cookie }) => openWs(lab.socketPath, { cookie }));
  lab.beforeCleanup(() => sockets.forEach(({ ws }) => ws.terminate()));
  await Promise.all(sockets.map(({ ready }) => ready));
  const created = await request(
    lab.socketPath,
    {
      method: 'POST',
      pathname: lab.url(bob),
      cookie: alice.cookie,
      body: { text: 'Original' }
    },
    DirectMessageAnswer
  );
  const url = `${lab.url(bob)}/messages/${created.body.message.id}`;
  const edit = (text: string) =>
    request(lab.socketPath, { method: 'PATCH', pathname: url, cookie: alice.cookie, body: { text } });
  assert.equal((await edit('Edited')).status, 200);
  await Promise.all(sockets.map(({ frames }) => waitForWsType(frames, 'dm.message.edited')));

  assert.equal((await lab.settings(bob, { messagesFrom: 'friends', callsFrom: 'friends' })).status, 200);
  const closed = await edit('Privacy breach');
  assert.equal(closed.status, 403);
  assert.equal(closed.body.code, 'messages_closed');
  assert.equal(
    (
      await request(lab.socketPath, {
        method: 'PUT',
        pathname: `/api/blocks/${alice.id}`,
        cookie: bob.cookie
      })
    ).status,
    200
  );
  const blocked = await edit('Block breach');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, 'relationship_blocked');
  const history = await request(
    lab.socketPath,
    { pathname: `${lab.url(bob)}/history`, cookie: alice.cookie },
    DirectHistoryPage
  );
  assert.deepEqual(history.body.messages.find(({ id }) => id === created.body.message.id)?.content, {
    type: 'text',
    text: 'Edited'
  });
  assert.equal((await request(lab.socketPath, { method: 'DELETE', pathname: url, cookie: alice.cookie })).status, 200);
  for (const { frames } of sockets) {
    await waitForWsType(frames, 'dm.message.deleted');
    assert.equal(countWsType(frames, 'dm.message.edited'), 1);
  }
});

test('the tenth stranger chat can start by voice call or room invite, and each kind refuses the eleventh', async (t) => {
  const lab = await setup(t);
  const peers = await Promise.all(Array.from({ length: 11 }, (_, index) => lab.account(`peer${index}`)));
  const tenth = peers[9];
  const eleventh = peers[10];
  assert.ok(tenth && eleventh);
  for (const peer of [tenth, eleventh]) {
    assert.equal((await lab.settings(peer, { messagesFrom: 'everyone', callsFrom: 'everyone' })).status, 200);
  }
  for (const kind of ['voice', 'invite'] as const) {
    const caller = await lab.account(kind);
    for (const peer of peers.slice(0, 9)) assert.equal((await lab.send(caller, peer)).status, 201);
    const room = await request(
      lab.socketPath,
      {
        method: 'POST',
        pathname: '/api/rooms',
        cookie: caller.cookie,
        body: { isStatic: true, name: 'Privacy room' }
      },
      RoomCreated
    );
    const ring = (peer: Account) =>
      request(lab.socketPath, {
        method: 'POST',
        pathname: kind === 'voice' ? '/api/call-rings' : '/api/rings',
        cookie: caller.cookie,
        body: {
          ...(kind === 'voice' ? { peerUserId: peer.id } : { userId: peer.id, roomId: room.body.roomId }),
          clientRequestId: randomUUID()
        }
      });
    assert.equal((await ring(tenth)).status, 200);
    const capped = await ring(eleventh);
    assert.equal(capped.status, 429);
    assert.equal(capped.body.code, 'chat_cap_reached');
    assert.equal((await lab.send(caller, eleventh)).body.code, 'chat_cap_reached');
    assert.equal((await lab.send(caller, tenth)).status, 201);
  }
});

test('a reply queued behind friendship removal or a block follows the committed relationship', async (t) => {
  const lab = await setup(t);
  const alice = await lab.account('alice');
  const pool = new Pool({ connectionString: lab.databaseUrl });
  lab.beforeCleanup(() => pool.end());
  const db = kyselyOn(pool);

  for (const change of ['unfriend', 'block'] as const) {
    const peer = await lab.account(change);
    await sendFriendRequest(lab.socketPath, alice.cookie, change);
    await acceptFirstFriendRequest(lab.socketPath, peer.cookie);
    assert.equal((await lab.settings(peer, { messagesFrom: 'friends', callsFrom: 'friends' })).status, 200);
    const { body } = await request(
      lab.socketPath,
      {
        method: 'POST',
        pathname: lab.url(alice),
        cookie: peer.cookie,
        body: { text: 'Quoted message' }
      },
      DirectMessageAnswer
    );

    const [changed, replied] = await withTransaction(db, async (tx) => {
      await lockUserPair(tx, alice.id, peer.id);
      const holder = await sql<{ pid: number }>`SELECT pg_backend_pid() AS pid`.execute(tx);
      async function waitForQueuedWriters(expected: number) {
        for (let attempt = 0; attempt < 100; attempt++) {
          const { rows } = await sql<{ count: number }>`
            SELECT count(*)::int AS count
            FROM pg_locks held
            JOIN pg_locks queued USING (locktype, database, classid, objid, objsubid)
            WHERE held.pid = ${holder.rows[0]?.pid}
              AND held.locktype = 'advisory' AND held.granted AND NOT queued.granted
          `.execute(db);
          if (rows[0]?.count === expected) return;
          await delay(25);
        }
        assert.fail(`Expected ${expected} writers to wait on the pair lock`);
      }
      const changed = request(lab.socketPath, {
        method: change === 'unfriend' ? 'DELETE' : 'PUT',
        pathname: change === 'unfriend' ? `/api/friends/${alice.id}` : `/api/blocks/${alice.id}`,
        cookie: peer.cookie
      });
      await waitForQueuedWriters(1);
      const replied = request(lab.socketPath, {
        method: 'POST',
        pathname: lab.url(peer),
        cookie: alice.cookie,
        body: { text: 'Reply', replyTo: { messageId: body.message.id } }
      });
      await waitForQueuedWriters(2);
      return [changed, replied] as const;
    });
    const [result, reply] = await Promise.all([changed, replied]);
    assert.equal(result.status, 200);
    assert.equal(reply.status, 403);
    assert.equal(reply.body.code, change === 'unfriend' ? 'messages_closed' : 'relationship_blocked');
  }
});
