// Reports to the service operator: a signed-in account reports a message it
// can see, and only a platform administrator lists the open reports and
// removes the message or dismisses them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import type { Me, SignedIn } from '@voice-room/shared/contracts/account';
import type { Failure } from '@voice-room/shared/contracts/http';
import type { AdminReportPage, ReportFiled, ReportResolved } from '@voice-room/shared/contracts/reports';
import { hashPassword } from '../src/lib/password.ts';
import { cookieFrom, registerAccount, request, startApiServer } from './fakes/server-process.ts';

const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';

test('a report reaches the platform administrator, who removes the message or dismisses it', async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-reports-',
    env: { AUTH_RATE_LIMIT: '0', PLATFORM_ADMIN_USER_IDS: ` ${ADMIN_ID} , someone-else` }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());

  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ADMIN_ID,
    await hashPassword('password123')
  ]);
  const signedIn = await request<SignedIn>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: { login: 'root', password: 'password123' }
  });
  assert.equal(signedIn.status, 200);
  const admin = cookieFrom(signedIn.setCookie);

  const alice = await registerAccount(socketPath, 'alice');
  const bob = await registerAccount(socketPath, 'bob');
  const eve = await registerAccount(socketPath, 'eve');
  const idOf = async (cookie: string) =>
    (await request<Me>(socketPath, { pathname: '/api/auth/me', cookie })).body.user!.id;
  const [aliceId, bobId] = [await idOf(alice), await idOf(bob)];

  await pool.query(
    `INSERT INTO rooms (id, creator_ip, is_static, owner_id, name) VALUES ('kitchen', '', true, $1, 'Кухня')`,
    [bobId]
  );
  await pool.query(
    `INSERT INTO room_memberships (id, room_id, user_id) VALUES ('m-alice', 'kitchen', $1), ('m-bob', 'kitchen', $2)`,
    [aliceId, bobId]
  );
  await pool.query(
    `INSERT INTO room_messages (id, room_id, peer_id, name, text, author_user_id)
     VALUES ('rm-1', 'kitchen', 'peer-bob', 'bob', 'купите подписку', $1)`,
    [bobId]
  );
  await pool.query(`INSERT INTO rooms (id, creator_ip, is_static, name) VALUES ('temp', '', false, 'Временная')`);
  await pool.query(
    `INSERT INTO room_messages (id, room_id, peer_id, name, text, author_user_id)
     VALUES ('rm-temp', 'temp', 'peer-bob', 'bob', 'в временной комнате', $1)`,
    [bobId]
  );
  await pool.query(
    `INSERT INTO direct_messages (id, sender_id, recipient_id, body)
     VALUES ('dm-1', $1, $2, 'грубость'), ('dm-2', $1, $2, 'угроза')`,
    [bobId, aliceId]
  );

  const report = (cookie: string | undefined, target: object, reason = 'spam') =>
    request<Pick<ReportFiled, 'status'> | Pick<Failure, 'code'>>(socketPath, {
      method: 'POST',
      pathname: '/api/reports',
      cookie,
      body: { target, reason, comment: '  проверьте, пожалуйста  ' }
    });
  const roomMessage = { kind: 'room_message', roomId: 'kitchen', messageId: 'rm-1' };

  assert.equal((await report(undefined, roomMessage)).status, 401);
  const outsider = await report(eve, roomMessage);
  assert.equal(outsider.status, 404);
  assert.equal(outsider.body.code, 'report_target_not_found');
  const own = await report(bob, roomMessage);
  assert.equal(own.status, 400);
  assert.equal(own.body.code, 'report_own_message');
  assert.equal((await report(alice, { kind: 'room_message', roomId: 'kitchen', messageId: 'missing' })).status, 404);
  assert.equal((await report(alice, roomMessage, 'nonsense')).status, 400);

  // A temporary room is open to anyone with its link, so anyone may report there.
  assert.equal((await report(eve, { kind: 'room_message', roomId: 'temp', messageId: 'rm-temp' })).status, 201);

  const filed = await report(alice, roomMessage);
  assert.equal(filed.status, 201);
  assert.equal(filed.body.status, 'filed');
  const again = await report(alice, roomMessage);
  assert.equal(again.status, 200);
  assert.equal(again.body.status, 'already_filed');

  assert.equal((await report(alice, { kind: 'direct_message', messageId: 'dm-1' }, 'abuse')).status, 201);
  assert.equal((await report(alice, { kind: 'direct_message', messageId: 'dm-2' }, 'illegal')).status, 201);
  assert.equal((await report(bob, { kind: 'direct_message', messageId: 'dm-1' })).body.code, 'report_own_message');
  assert.equal((await report(eve, { kind: 'direct_message', messageId: 'dm-1' })).status, 404);

  const forbidden = await request<Failure>(socketPath, { pathname: '/api/admin/reports', cookie: alice });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, 'platform_admin_required');
  assert.equal((await request(socketPath, { pathname: '/api/admin/reports' })).status, 401);

  const list = async () => {
    const page = await request<AdminReportPage>(socketPath, { pathname: '/api/admin/reports', cookie: admin });
    assert.equal(page.status, 200);
    return page.body.reports;
  };
  const open = await list();
  assert.equal(open.length, 4);
  const [tempReport, roomReport, dmReport, threatReport] = open;
  assert.equal(tempReport!.target.roomName, 'Временная');
  assert.equal(roomReport!.comment, 'проверьте, пожалуйста');
  assert.deepEqual(roomReport!.reporter, { userId: aliceId, login: 'alice', displayName: 'alice' });
  assert.equal(roomReport!.target.roomName, 'Кухня');
  assert.equal(roomReport!.target.text, 'купите подписку');
  assert.equal(roomReport!.target.authorUserId, bobId);
  assert.equal(roomReport!.target.deleted, false);
  assert.equal(dmReport!.target.kind, 'direct_message');
  assert.equal(dmReport!.target.text, 'грубость');
  assert.equal(dmReport!.target.authorName, 'bob');
  assert.equal(threatReport!.reason, 'illegal');

  const resolve = (cookie: string, reportId: string, action: string) =>
    request<Pick<ReportResolved, 'resolved'> | Pick<Failure, 'code'>>(socketPath, {
      method: 'POST',
      pathname: `/api/admin/reports/${reportId}/resolve`,
      cookie,
      body: { action }
    });
  assert.equal((await resolve(alice, roomReport!.id, 'remove_message')).status, 403);
  assert.equal((await resolve(admin, 'not-a-uuid', 'dismiss')).body.code, 'report_not_found');

  const removed = await resolve(admin, roomReport!.id, 'remove_message');
  assert.equal(removed.status, 200);
  assert.equal(removed.body.resolved, 1);
  const roomRow = await pool.query<{ deleted_at: Date | null }>(
    `SELECT deleted_at FROM room_messages WHERE id = 'rm-1'`
  );
  assert.ok(roomRow.rows[0]?.deleted_at, 'the room message is gone for everyone');
  assert.equal((await resolve(admin, roomReport!.id, 'remove_message')).status, 404, 'a resolved report is closed');

  assert.equal((await resolve(admin, dmReport!.id, 'dismiss')).body.resolved, 1);
  assert.equal((await resolve(admin, threatReport!.id, 'remove_message')).body.resolved, 1);
  assert.equal((await resolve(admin, tempReport!.id, 'dismiss')).body.resolved, 1);
  const dms = await pool.query<{ id: string; deleted_at: Date | null }>(
    `SELECT id, deleted_at FROM direct_messages ORDER BY id`
  );
  assert.equal(dms.rows[0]?.deleted_at, null, 'a dismissed report leaves the message');
  assert.ok(dms.rows[1]?.deleted_at, 'a removed direct message is gone for both sides');

  assert.deepEqual(await list(), []);
  const reportRows = await pool.query<{ status: string; resolved_by_user_id: string }>(
    `SELECT status, resolved_by_user_id FROM content_reports ORDER BY created_at`
  );
  assert.deepEqual(
    reportRows.rows.map((row) => [row.status, row.resolved_by_user_id]),
    [
      ['dismissed', ADMIN_ID],
      ['actioned', ADMIN_ID],
      ['dismissed', ADMIN_ID],
      ['actioned', ADMIN_ID]
    ]
  );

  // A removed message can no longer be reported.
  assert.equal((await report(eve, { kind: 'direct_message', messageId: 'dm-2' })).status, 404);
  assert.equal((await report(alice, roomMessage)).status, 404);
});

test('reports are rate limited per account', async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-report-limit-',
    env: { AUTH_RATE_LIMIT: '0', REPORT_RATE_LIMIT: '2' }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  const alice = await registerAccount(socketPath, 'alice');
  const send = () =>
    request<Failure>(socketPath, {
      method: 'POST',
      pathname: '/api/reports',
      cookie: alice,
      body: { target: { kind: 'direct_message', messageId: 'missing' }, reason: 'spam' }
    });
  assert.equal((await send()).status, 404);
  assert.equal((await send()).status, 404);
  const limited = await send();
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'rate_limited');
});
