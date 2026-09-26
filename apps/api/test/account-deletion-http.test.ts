import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createAccountDeletionRepository } from '../src/domains/account/account-deletion.repository.ts';
import { ACCOUNT_DELETION_GRACE_MS } from '@voice-room/shared/account-security';
import type {
  AccountFailure,
  DeletionPreview,
  DeletionScheduled,
  Me,
  SignedIn
} from '@voice-room/shared/contracts/account';
import { cookieFrom, request, startApiServer } from './fakes/server-process.ts';

test('an account can be deleted, restored within the grace period and never re-registered afterwards', async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-account-deletion-',
    env: { AUTH_RATE_LIMIT: '0' }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());

  const credentials = { login: 'ada', password: 'lovelace-1843' };
  const registered = await request<SignedIn>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { ...credentials, passwordConfirm: credentials.password }
  });
  assert.equal(registered.status, 201);
  const cookie = cookieFrom(registered.setCookie);

  assert.equal((await request(socketPath, { pathname: '/api/auth/account/deletion' })).status, 401);
  const preview = await request<DeletionPreview>(socketPath, { pathname: '/api/auth/account/deletion', cookie });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body.rooms, []);
  assert.equal(preview.body.graceDays, 7);

  const wrongPassword = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/account/deletion',
    cookie,
    body: { currentPassword: 'nope' }
  });
  assert.equal(wrongPassword.status, 400);

  const requested = await request<DeletionScheduled>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/account/deletion',
    cookie,
    body: { currentPassword: credentials.password }
  });
  assert.equal(requested.status, 200);
  assert.ok(requested.body.deletionScheduledFor > Date.now() + ACCOUNT_DELETION_GRACE_MS - 60_000);
  assert.match(String(requested.setCookie[0] || ''), /Max-Age=0/);
  assert.equal((await request<Me>(socketPath, { pathname: '/api/auth/me', cookie })).body.user, null);

  const pendingLogin = await request<AccountFailure>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: credentials
  });
  assert.equal(pendingLogin.status, 409);
  assert.equal(pendingLogin.body.code, 'account_deletion_pending');
  assert.equal(pendingLogin.body.deletionScheduledFor, requested.body.deletionScheduledFor);
  assert.equal(pendingLogin.setCookie.length, 0);

  assert.equal(
    (
      await request(socketPath, {
        method: 'POST',
        pathname: '/api/auth/account/restore',
        body: { ...credentials, password: 'nope' }
      })
    ).status,
    401
  );
  const restored = await request<SignedIn>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/account/restore',
    body: credentials
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.user.login, 'ada');
  const restoredCookie = cookieFrom(restored.setCookie);
  assert.equal(
    (await request<Me>(socketPath, { pathname: '/api/auth/me', cookie: restoredCookie })).body.user?.login,
    'ada'
  );

  // Delete again and let the grace period run out.
  const again = await request<DeletionScheduled>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/account/deletion',
    cookie: restoredCookie,
    body: { currentPassword: credentials.password }
  });
  assert.equal(again.status, 200);
  const deletion = createAccountDeletionRepository({ pool });
  const [userId] = await deletion.listDueDeletions({ now: again.body.deletionScheduledFor + 1 });
  assert.ok(userId);
  assert.equal(
    (await deletion.finalizeDeletion({ userId, now: again.body.deletionScheduledFor + 1 })).status,
    'deleted'
  );

  assert.equal(
    (await request(socketPath, { method: 'POST', pathname: '/api/auth/login', body: credentials })).status,
    401
  );
  assert.equal(
    (await request(socketPath, { method: 'POST', pathname: '/api/auth/account/restore', body: credentials })).status,
    401
  );
  for (const login of ['ada', 'deleted-anything']) {
    const reuse = await request(socketPath, {
      method: 'POST',
      pathname: '/api/auth/register',
      body: { login, password: 'another-password', passwordConfirm: 'another-password' }
    });
    assert.equal(reuse.status, 409, `${login} must stay taken`);
  }
});
