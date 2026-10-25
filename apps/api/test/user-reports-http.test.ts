import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Me, SignedIn } from '@voice-room/shared/contracts/account';
import { Failure } from '@voice-room/shared/contracts/http';
import {
  AdminReportPage,
  AdminUserReportPage,
  ReportFiled,
  ReportResolved
} from '@voice-room/shared/contracts/reports';
import { hashPassword } from '../src/lib/password.ts';
import { cookieFrom, registerAccount, request, startApiServer } from './fakes/server-process.ts';
import { defined } from './helpers/assert-defined.ts';
import { staffCookie } from './staff-session.ts';

const ADMIN_ID = '00000000-0000-4000-8000-0000000000ad';

test('user and message reports share the per-account rate limit', async (t) => {
  const { socketPath } = await startApiServer(t, {
    prefix: 'voice-room-user-report-limit-',
    env: { AUTH_RATE_LIMIT: '0', REPORT_RATE_LIMIT: '2' }
  });
  const alice = await registerAccount(socketPath, 'alice');
  const send = (target: object) =>
    request(
      socketPath,
      {
        method: 'POST',
        pathname: '/api/reports',
        cookie: alice,
        body: { target, reason: 'spam' }
      },
      Failure
    );
  assert.equal((await send({ kind: 'user', userId: 'missing' })).status, 404);
  assert.equal((await send({ kind: 'direct_message', messageId: 'missing' })).status, 404);
  const limited = await send({ kind: 'user', userId: 'missing' });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, 'rate_limited');
});

test('user reports have separate review, dedupe and non-destructive resolution', async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-user-reports-',
    env: { AUTH_RATE_LIMIT: '0', PLATFORM_ADMIN_USER_IDS: ADMIN_ID }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ($1, 'root', $2)`, [
    ADMIN_ID,
    await hashPassword('password123')
  ]);
  const root = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/auth/login',
      body: { login: 'root', password: 'password123' }
    },
    SignedIn
  );
  const admin = await staffCookie(socketPath, cookieFrom(root.setCookie));
  const alice = await registerAccount(socketPath, 'alice');
  const bob = await registerAccount(socketPath, 'bob');
  const eve = await registerAccount(socketPath, 'eve');
  const idOf = async (cookie: string) =>
    defined((await request(socketPath, { pathname: '/api/auth/me', cookie }, Me)).body.user, 'user').id;
  const [aliceId, bobId] = await Promise.all([idOf(alice), idOf(bob)]);
  const file = (cookie: string | undefined, userId = bobId) =>
    request(socketPath, {
      method: 'POST',
      pathname: '/api/reports',
      cookie,
      body: { target: { kind: 'user', userId }, reason: 'abuse', comment: '  repeated harassment  ' }
    });
  assert.equal((await file(undefined)).status, 401);
  assert.equal((await file(alice, aliceId)).status, 400);
  assert.equal((await file(alice, 'missing')).status, 404);
  assert.equal((await file(alice, 'not-a-uuid')).status, 404);
  assert.equal((await file(alice)).status, 201);
  const duplicate = await request(
    socketPath,
    {
      method: 'POST',
      pathname: '/api/reports',
      cookie: alice,
      body: { target: { kind: 'user', userId: bobId }, reason: 'spam' }
    },
    ReportFiled
  );
  assert.equal(duplicate.body.status, 'already_filed');
  assert.equal((await file(eve)).status, 201);
  assert.equal((await request(socketPath, { pathname: '/api/admin/user-reports' }, Failure)).status, 401);
  assert.equal(
    (await request(socketPath, { pathname: '/api/admin/user-reports', cookie: alice }, Failure)).status,
    403
  );
  const page = await request(socketPath, { pathname: '/api/admin/user-reports', cookie: admin }, AdminUserReportPage);
  assert.equal(page.status, 200);
  assert.equal(page.body.reports.length, 2);
  const report = defined(page.body.reports[0], 'user report');
  assert.equal(report.target.userId, bobId);
  assert.equal(report.target.login, 'bob');
  assert.equal(report.comment, 'repeated harassment');
  const legacy = await request(socketPath, { pathname: '/api/admin/reports', cookie: admin }, AdminReportPage);
  assert.deepEqual(legacy.body.reports, []);
  const resolve = (cookie: string, action: string) =>
    request(socketPath, {
      method: 'POST',
      pathname: `/api/admin/user-reports/${report.id}/resolve`,
      cookie,
      body: { action }
    });
  assert.equal((await resolve(alice, 'reviewed')).status, 403);
  assert.equal((await resolve(admin, 'remove_message')).status, 400);
  const reviewed = await request(
    socketPath,
    {
      method: 'POST',
      pathname: `/api/admin/user-reports/${report.id}/resolve`,
      cookie: admin,
      body: { action: 'reviewed' }
    },
    ReportResolved
  );
  assert.equal(reviewed.body.resolved, 2);
  assert.equal((await resolve(admin, 'dismiss')).status, 404);
  assert.equal((await pool.query(`SELECT id FROM users WHERE id = $1`, [bobId])).rowCount, 1);
  assert.deepEqual(
    (await request(socketPath, { pathname: '/api/admin/user-reports', cookie: admin }, AdminUserReportPage)).body
      .reports,
    []
  );
  assert.equal((await file(alice)).status, 201, 'a resolved target can be reported again');
  const reopened = (
    await request(socketPath, { pathname: '/api/admin/user-reports', cookie: admin }, AdminUserReportPage)
  ).body.reports;
  const reopenedId = defined(reopened[0], 'reopened report').id;
  await pool.query(`UPDATE users SET deleted_at = now() WHERE id = $1`, [bobId]);
  assert.equal((await file(eve)).status, 404, 'a deleted account cannot receive a new report');
  const anonymized = defined(
    (await request(socketPath, { pathname: '/api/admin/user-reports', cookie: admin }, AdminUserReportPage)).body
      .reports[0],
    'anonymized target'
  );
  assert.equal(anonymized.target.deleted, true);
  assert.equal(anonymized.target.login, '');
  assert.equal(anonymized.target.displayName, '');
  await pool.query(`DELETE FROM users WHERE id = $1`, [bobId]);
  const deleted = (
    await request(socketPath, { pathname: '/api/admin/user-reports', cookie: admin }, AdminUserReportPage)
  ).body.reports;
  assert.equal(defined(deleted[0], 'deleted user report').target.deleted, true);
  assert.equal(
    (
      await request(
        socketPath,
        {
          method: 'POST',
          pathname: `/api/admin/user-reports/${reopenedId}/resolve`,
          cookie: admin,
          body: { action: 'dismiss' }
        },
        ReportResolved
      )
    ).body.resolved,
    1
  );
});
