// The Android app's push tokens in PostgreSQL: a token belongs to its session
// and goes with it, moves to whoever registers it again, is capped per
// account, and is only listed while its session is live.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Type } from 'typebox';

import { createDeviceTokenRepository } from '../src/domains/notifications/device-token.repository.ts';
import { replacePassword } from '../src/domains/account/user.repository.ts';
import { kyselyOn } from '../src/platform/db/kysely.ts';
import { DateColumn, queryRows } from './helpers/checked.ts';
import { createTestDatabase } from './db-harness.ts';

const skip = !process.env.TEST_DATABASE_URL;

const TokenRow = Type.Object({
  user_id: Type.String(),
  session_id: Type.String(),
  provider: Type.String(),
  token: Type.String(),
  app_version: Type.Union([Type.String(), Type.Null()]),
  last_seen_at: DateColumn
});

// Two accounts: ada signed in on two phones (s1, s2), bob on one (s3).
async function seeded(t: TestContext, options: { maxTokensPerUser?: number } = {}) {
  const { cleanup, pool } = await createTestDatabase(t);
  t.after(cleanup);
  await pool.query(`INSERT INTO users (id, login, password_hash) VALUES ('ada', 'ada', 'x'), ('bob', 'bob', 'x')`);
  await pool.query(
    `INSERT INTO sessions (id, user_id, expires_at)
     VALUES ('s1', 'ada', now() + interval '1 day'), ('s2', 'ada', now() + interval '1 day'),
            ('s3', 'bob', now() + interval '1 day')`
  );
  const tokens = createDeviceTokenRepository({ pool, ...options });
  const rows = () =>
    queryRows(
      pool,
      TokenRow,
      'SELECT user_id, session_id, provider, token, app_version, last_seen_at FROM device_tokens ORDER BY token'
    );
  const register = (token: string, sessionId = 's1', userId = 'ada', appVersion: string | null = '1.0.0') =>
    tokens.upsert({ userId, sessionId, provider: 'rustore', token, appVersion });
  return { pool, tokens, rows, register };
}

test('registering stores the token for the session, and registering it again moves it', { skip }, async (t) => {
  const { pool, rows, register } = await seeded(t);

  await register('phone-1', 's1', 'ada', '1.2.3');
  const [stored] = await rows();
  assert.ok(stored);
  assert.deepEqual(
    { ...stored, last_seen_at: undefined },
    {
      user_id: 'ada',
      session_id: 's1',
      provider: 'rustore',
      token: 'phone-1',
      app_version: '1.2.3',
      last_seen_at: undefined
    }
  );

  const stale = new Date('2026-01-01T00:00:00Z');
  await pool.query(`UPDATE device_tokens SET last_seen_at = $1`, [stale]);
  await register('phone-1', 's3', 'bob', null);
  const [moved, ...rest] = await rows();
  assert.deepEqual(rest, [], 'one row per token');
  assert.ok(moved);
  assert.deepEqual([moved.user_id, moved.session_id, moved.app_version], ['bob', 's3', null]);
  assert.ok(moved.last_seen_at > stale, 'registering again touches last_seen_at');
});

test('ending a session deletes its tokens, and a password change deletes all of the account', { skip }, async (t) => {
  const { pool, rows, register } = await seeded(t);
  await register('ada-phone', 's1');
  await register('ada-tablet', 's2');
  await register('bob-phone', 's3', 'bob');

  await pool.query(`DELETE FROM sessions WHERE id = 's1'`);
  assert.deepEqual(
    (await rows()).map((row) => row.token),
    ['ada-tablet', 'bob-phone']
  );

  await register('ada-phone', 's2');
  await kyselyOn(pool)
    .transaction()
    .execute((trx) => replacePassword(trx, { userId: 'ada', newPassword: 'a new password', now: Date.now() }));
  assert.deepEqual(
    (await rows()).map((row) => row.token),
    ['bob-phone']
  );
});

test('an account keeps its 10 most recently seen tokens', { skip }, async (t) => {
  const { tokens, register } = await seeded(t);
  for (let index = 1; index <= 12; index += 1) await register(`phone-${String(index).padStart(2, '0')}`);
  const kept = (await tokens.listByUserId('ada')).map((one) => one.token);
  assert.deepEqual(kept, [
    'phone-12',
    'phone-11',
    'phone-10',
    'phone-09',
    'phone-08',
    'phone-07',
    'phone-06',
    'phone-05',
    'phone-04',
    'phone-03'
  ]);

  // Seeing the oldest again keeps it; the next oldest goes instead.
  await register('phone-03');
  await register('phone-13');
  const after = (await tokens.listByUserId('ada')).map((one) => one.token);
  assert.equal(after.length, 10);
  assert.equal(after.includes('phone-03'), true);
  assert.equal(after.includes('phone-04'), false);
});

test('the per-account cap is configurable', { skip }, async (t) => {
  const { tokens, register } = await seeded(t, { maxTokensPerUser: 2 });
  await register('a');
  await register('b');
  await register('c');
  assert.deepEqual(
    (await tokens.listByUserId('ada')).map((one) => one.token),
    ['c', 'b']
  );
});

test('a token whose session has expired is not listed', { skip }, async (t) => {
  const { pool, tokens, register } = await seeded(t);
  await register('live', 's1', 'ada', '1.2.3');
  await register('expired', 's2', 'ada', null);
  // Whole milliseconds, so the boundary below is exact.
  const at = Date.now() + 60 * 60 * 1000;
  await pool.query(`UPDATE sessions SET expires_at = $1 WHERE id = 's2'`, [new Date(at)]);

  assert.deepEqual(await tokens.listByUserId('ada', at - 1), [
    { provider: 'rustore', token: 'expired', appVersion: null },
    { provider: 'rustore', token: 'live', appVersion: '1.2.3' }
  ]);
  assert.deepEqual(await tokens.listByUserId('ada', at), [{ provider: 'rustore', token: 'live', appVersion: '1.2.3' }]);
  assert.deepEqual(await tokens.listByUserId('bob'), []);
});

test("removing takes only the caller's own token; a pruned token goes whoever owns it", { skip }, async (t) => {
  const { tokens, rows, register } = await seeded(t);
  await register('ada-phone', 's1');
  await register('bob-phone', 's3', 'bob');

  assert.equal(await tokens.remove({ userId: 'bob', provider: 'rustore', token: 'ada-phone' }), false);
  assert.equal(await tokens.remove({ userId: 'ada', provider: 'rustore', token: 'ada-phone' }), true);
  assert.equal(await tokens.remove({ userId: 'ada', provider: 'rustore', token: 'ada-phone' }), false);
  assert.deepEqual(
    (await rows()).map((row) => row.token),
    ['bob-phone']
  );

  await tokens.removeToken({ provider: 'rustore', token: 'bob-phone' });
  assert.deepEqual(await rows(), []);
});
