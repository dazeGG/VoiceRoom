import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { Me } from '@voice-room/shared/contracts/account';
import { RingAnswer } from '@voice-room/shared/contracts/rings';
import { Done } from '@voice-room/shared/contracts/http';
import {
  registerAccount,
  request,
  startApiServer,
  sendFriendRequest,
  acceptFirstFriendRequest
} from './fakes/server-process.ts';

test('new Ring routes authorize actors, replay safely and retain the exact legacy response', async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-rings-',
    env: { AUTH_RATE_LIMIT: '0', RING_RATE_LIMIT: '0' }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  const alice = await registerAccount(socketPath, 'alice'),
    bob = await registerAccount(socketPath, 'bob'),
    eve = await registerAccount(socketPath, 'eve');
  const a = (await request(socketPath, { pathname: '/api/auth/me', cookie: alice }, Me)).body.user;
  const b = (await request(socketPath, { pathname: '/api/auth/me', cookie: bob }, Me)).body.user;
  assert.ok(a && b);
  await sendFriendRequest(socketPath, alice, 'bob');
  await acceptFirstFriendRequest(socketPath, bob);
  await pool.query(`INSERT INTO rooms(id,name) VALUES('ring-room','Team')`);
  const body = { roomId: 'ring-room', userId: b.id, clientRequestId: crypto.randomUUID() };
  assert.equal((await request(socketPath, { method: 'POST', pathname: '/api/rings', body })).status, 401);
  assert.equal((await request(socketPath, { method: 'POST', pathname: '/api/rings', body, cookie: eve })).status, 403);
  const created = await request(
    socketPath,
    { method: 'POST', pathname: '/api/rings', body, cookie: alice },
    RingAnswer
  );
  assert.equal(created.status, 200);
  assert.equal(created.body.ring.state, 'pending');
  const id = created.body.ring.id;
  const status = await request(socketPath, { pathname: `/api/rings/${id}`, cookie: alice }, RingAnswer);
  assert.equal(status.headers['cache-control'], 'no-store');
  const replay = await request(socketPath, { method: 'POST', pathname: '/api/rings', body, cookie: alice }, RingAnswer);
  assert.equal(replay.body.ring.id, id);
  assert.equal((await pool.query('SELECT * FROM direct_messages')).rowCount, 1);
  assert.equal(
    (
      await request(socketPath, {
        method: 'POST',
        pathname: '/api/rings',
        body: { ...body, roomId: 'other' },
        cookie: alice
      })
    ).status,
    409
  );
  for (const [cookie, pathname, method, body] of [
    [eve, `/api/rings/${id}`, 'GET', undefined],
    [alice, `/api/rings/${id}/respond`, 'POST', { action: 'accept' }],
    [bob, `/api/rings/${id}/cancel`, 'POST', {}]
  ] as const) {
    assert.equal((await request(socketPath, { cookie, pathname, method, body })).status, 404);
  }
  const accepted = await request(
    socketPath,
    { cookie: bob, method: 'POST', pathname: `/api/rings/${id}/respond`, body: { action: 'accept' } },
    RingAnswer
  );
  assert.equal(accepted.body.ring.state, 'accepted');
  const lateCancel = await request(
    socketPath,
    { cookie: alice, method: 'POST', pathname: `/api/rings/${id}/cancel`, body: {} },
    RingAnswer
  );
  assert.equal(lateCancel.body.ring.state, 'accepted');
  const legacy = await request(
    socketPath,
    { cookie: alice, method: 'POST', pathname: '/api/rooms/ring-room/ring', body: { userId: b.id } },
    Done
  );
  assert.equal(legacy.status, 200);
  assert.deepEqual(legacy.body, { ok: true });
  assert.equal((await pool.query('SELECT * FROM room_rings')).rowCount, 2);
  assert.equal(
    (await pool.query<{ status: string }>(`SELECT metadata->>'status' AS status FROM direct_messages`)).rows.every(
      (row) => row.status === 'pending'
    ),
    true
  );
});
