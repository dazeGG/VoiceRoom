import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type pg from 'pg';
import { createTestDatabase } from './db-harness.ts';
import { runMigrations } from '../src/lib/migrate.ts';
import { createUserStore } from '../src/app/user-store.ts';
import { createAccountStandingRepository } from '../src/domains/account/account-standing.repository.ts';
import { createAccountDeletionRepository } from '../src/domains/account/account-deletion.repository.ts';
import { createAccountService } from '../src/domains/account/account.service.ts';
import { createAdminAccountsService } from '../src/domains/admin/admin-accounts.service.ts';
import { SessionIssuanceError } from '../src/domains/account/session-proof.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const PASSWORD = 'original-password';
const NEXT = 'replacement-password';
const device = async () => ({ userAgent: '', locationLabel: '' });

async function setup(t: TestContext) {
  const { pool, databaseUrl, cleanup } = await createTestDatabase(t);
  t.after(cleanup);
  await runMigrations({ databaseUrl, logger: SILENT });
  const users = createUserStore({ pool, logger: SILENT });
  const standing = createAccountStandingRepository({ pool });
  const deletions = createAccountDeletionRepository({ pool });
  const created = await users.createUser({ login: 'alice', displayName: 'Alice', password: PASSWORD });
  assert.ok(created.user);
  const user = created.user;
  const proof = { userId: user.id, passwordHash: user.passwordHash };
  const effects = { login: 0, ended: 0, actions: 0 };
  const account = createAccountService({
    users: () => ({
      ...users,
      async recordLogin(input) {
        effects.login++;
        return users.recordLogin(input);
      }
    }),
    deletions: () => deletions,
    loginFailures: { reserve: () => ({ allowed: true }), reset() {} },
    async endSessionConnections() {
      effects.ended++;
    },
    notifyUser() {},
    async queuePush() {},
    refreshActiveProfile() {},
    async broadcastProfileToFriends() {},
    logger: () => SILENT
  });
  const admin = createAdminAccountsService({
    staff: { can: async (_id, permission) => permission !== 'accounts.manage', memberIds: async () => [] },
    accounts: () => ({
      list: async () => {
        throw new Error('unused');
      },
      detail: async () => null
    }),
    standing: () => standing,
    deletions: () => deletions,
    actions: () => ({
      record: async () => {
        effects.actions++;
      },
      listFor: async () => []
    }),
    onlineUserIds: () => [],
    async endSessionConnections() {
      effects.ended++;
    },
    async profileChanged() {},
    logger: () => SILENT
  });
  return { pool, users, user, proof, standing, deletions, account, admin, effects };
}

async function waitForLock(pool: pg.Pool, count = 1) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database()
       AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'`
    );
    if ((result.rows[0]?.waiting ?? 0) >= count) return;
    await delay(10);
  }
  throw new Error('Expected the concurrent transaction to wait for the user lock');
}

for (const action of ['block', 'unblock'] as const) {
  test(`permanent block wins the row lock before moderator ${action}; refusal has no side effects`, async (t) => {
    const { pool, user, users, proof, admin, standing, effects } = await setup(t);
    await users.createSession({ credentialProof: proof });
    await pool.query(
      `INSERT INTO push_subscriptions (id, endpoint, user_id, p256dh, auth) VALUES ('fixture-push', 'https://fixture.invalid/push', $1, 'key', 'auth')`,
      [user.id]
    );
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE users SET blocked_at = now(), blocked_until = NULL, block_reason = 'permanent' WHERE id = $1`,
        [user.id]
      );
      const pending =
        action === 'block'
          ? admin.block('moderator', user.id, { duration: 'day', reason: 'temporary' })
          : admin.unblock('moderator', user.id);
      await waitForLock(pool);
      await client.query('COMMIT');
      assert.deepEqual(await pending, { status: 'forbidden' });
      assert.deepEqual(effects, { login: 0, ended: 0, actions: 0 });
      assert.equal((await users.getUserById(user.id))?.blockReason, 'permanent');
      assert.equal((await pool.query('SELECT id FROM sessions WHERE user_id = $1', [user.id])).rowCount, 1);
      assert.equal(
        (await pool.query('SELECT endpoint FROM push_subscriptions WHERE user_id = $1', [user.id])).rowCount,
        1
      );
      assert.equal(await standing.unblock({ userId: user.id, canManage: true }), 'updated');
      assert.equal(
        await standing.block({ userId: user.id, until: Date.now() + 60000, reason: 'temporary', canManage: false }),
        'updated'
      );
      assert.equal(await standing.unblock({ userId: user.id, canManage: false }), 'updated');
      assert.equal(
        await standing.block({ userId: user.id, until: null, reason: 'permanent', canManage: false }),
        'forbidden'
      );
      assert.equal(
        await standing.block({ userId: user.id, until: null, reason: 'permanent', canManage: true }),
        'updated'
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
}

for (const mutation of ['password', 'blocked', 'pending', 'deleted'] as const) {
  test(`session issuance reads ${mutation} state committed while waiting for the user lock`, async (t) => {
    const { pool, user, users, proof } = await setup(t);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const statements = {
        password: `UPDATE users SET password_hash = 'superseded' WHERE id = $1`,
        blocked: `UPDATE users SET blocked_at = now(), blocked_until = NULL WHERE id = $1`,
        pending: `UPDATE users SET deletion_requested_at = now() WHERE id = $1`,
        deleted: `UPDATE users SET deleted_at = now() WHERE id = $1`
      };
      await client.query(statements[mutation], [user.id]);
      const pending = assert.rejects(users.createSession({ credentialProof: proof }), (error: unknown) => {
        assert.ok(error instanceof SessionIssuanceError);
        assert.equal(
          error.refusal.status,
          mutation === 'blocked' ? 'blocked' : mutation === 'pending' ? 'deletion_pending' : 'invalid_credentials'
        );
        return true;
      });
      await waitForLock(pool);
      await client.query('COMMIT');
      await pending;
      assert.equal((await pool.query('SELECT id FROM sessions')).rowCount, 0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
}

test('issuance winning first is revoked by the following password change', async (t) => {
  const { pool, user, users, proof } = await setup(t);
  const issued = await users.createSession({ credentialProof: proof });
  assert.ok(await users.getSessionUser(issued.token));
  assert.equal(
    (await users.changePassword({ userId: user.id, currentPassword: PASSWORD, newPassword: NEXT })).status,
    'updated'
  );
  assert.equal(await users.getSessionUser(issued.token), null);
  assert.equal((await pool.query('SELECT id FROM sessions')).rowCount, 0);
  await assert.rejects(users.createSession({ credentialProof: proof }), SessionIssuanceError);
});

for (const issuer of ['login', 'register', 'recovery', 'restore'] as const) {
  test(`${issuer} keeps its verified proof across device resolution and rejects a later password change`, async (t) => {
    const { users, user, pool, account, deletions, effects } = await setup(t);
    let remaining: number | undefined;
    let code = '';
    if (issuer === 'recovery') {
      const generated = await users.generateRecoveryCodes({ userId: user.id, currentPassword: PASSWORD });
      code = generated.codes[0] ?? '';
      remaining = generated.codes.length - 1;
    }
    if (issuer === 'restore') await deletions.requestDeletion({ userId: user.id, currentPassword: PASSWORD });
    const interposedDevice = async () => {
      const current = await users.getUserByLogin(issuer === 'register' ? 'new-user' : user.login);
      assert.ok(current);
      const changed = await users.changePassword({
        userId: current.id,
        currentPassword: issuer === 'recovery' ? NEXT : PASSWORD,
        newPassword: 'later-password'
      });
      assert.equal(changed.status, 'updated');
      return device();
    };
    const result =
      issuer === 'register'
        ? await account.register({
            login: 'new-user',
            displayName: '',
            password: PASSWORD,
            passwordConfirm: PASSWORD,
            device: interposedDevice
          })
        : issuer === 'recovery'
          ? await account.recover({ login: user.login, code, newPassword: NEXT, device: interposedDevice })
          : issuer === 'restore'
            ? await account.restore({ login: user.login, password: PASSWORD, device: interposedDevice })
            : await account.login({ login: user.login, password: PASSWORD, device: interposedDevice });
    assert.deepEqual(result, { status: issuer === 'recovery' ? 'invalid_code' : 'invalid_credentials' });
    assert.equal(effects.login, 0);
    assert.equal((await pool.query('SELECT id FROM sessions')).rowCount, 0);
    assert.equal(JSON.stringify(result).includes('passwordHash'), false);
    if (issuer === 'recovery') {
      assert.equal((await users.getRecoveryCodesStatus(user.id)).remaining, remaining);
      assert.equal((await users.recoverWithCode({ login: user.login, code, newPassword: NEXT })).status, 'invalid');
    }
    if (issuer === 'restore') {
      const restored = await users.getUserById(user.id);
      assert.equal(restored?.deletionRequestedAt, null);
      assert.equal(restored?.displayName, 'Alice');
    }
    if (issuer === 'register') assert.ok(await users.getUserByLogin('new-user'));
  });
}

test('recovery returns the replaced hash and opens exactly one valid session', async (t) => {
  const { users, user, proof, account, pool } = await setup(t);
  await users.createSession({ credentialProof: proof });
  const codes = await users.generateRecoveryCodes({ userId: user.id, currentPassword: PASSWORD });
  const result = await account.recover({ login: user.login, code: codes.codes[0], newPassword: NEXT, device });
  assert.equal(result.status, 'signed_in');
  if (result.status !== 'signed_in') return;
  assert.ok(await users.getSessionUser(result.token));
  assert.equal((await pool.query('SELECT id FROM sessions')).rowCount, 1);
  assert.equal(JSON.stringify(result).includes('passwordHash'), false);
});

for (const mutation of ['blocked', 'pending', 'deleted'] as const) {
  for (const issuer of ['login', 'recovery'] as const) {
    test(`${issuer} maps a newly ${mutation} account without issuing or recording a session`, async (t) => {
      const { users, user, pool, account, effects } = await setup(t);
      const codes =
        issuer === 'recovery'
          ? await users.generateRecoveryCodes({ userId: user.id, currentPassword: PASSWORD })
          : null;
      const interposedDevice = async () => {
        const statements = {
          blocked: `UPDATE users SET blocked_at = now(), blocked_until = NULL, block_reason = 'blocked' WHERE id = $1`,
          pending: `UPDATE users SET deletion_requested_at = now() WHERE id = $1`,
          deleted: `UPDATE users SET deleted_at = now() WHERE id = $1`
        };
        await pool.query(statements[mutation], [user.id]);
        return device();
      };
      const result =
        issuer === 'recovery'
          ? await account.recover({
              login: user.login,
              code: codes?.codes[0],
              newPassword: NEXT,
              device: interposedDevice
            })
          : await account.login({ login: user.login, password: PASSWORD, device: interposedDevice });
      assert.equal(
        result.status,
        mutation === 'blocked'
          ? 'blocked'
          : issuer === 'recovery'
            ? 'invalid_code'
            : mutation === 'pending'
              ? 'deletion_pending'
              : 'invalid_credentials'
      );
      assert.equal(effects.login, 0);
      assert.equal((await pool.query('SELECT id FROM sessions')).rowCount, 0);
    });
  }
}

test('proof mismatch remains generic even when the account is blocked', async (t) => {
  const { users, user, proof, standing } = await setup(t);
  await users.changePassword({ userId: user.id, currentPassword: PASSWORD, newPassword: NEXT });
  await standing.block({ userId: user.id, until: null, reason: 'private reason', canManage: true });
  await assert.rejects(users.createSession({ credentialProof: proof }), (error: unknown) => {
    assert.ok(error instanceof SessionIssuanceError);
    assert.deepEqual(error.refusal, { status: 'invalid_credentials' });
    return true;
  });
});

// Type-only contract: a caller cannot issue a session from an account id alone.
export function mandatoryProof(users: ReturnType<typeof createUserStore>) {
  // @ts-expect-error credentialProof is required at every issuer
  return users.createSession({ userId: 'unchecked' });
}

// A fixture-only advisory barrier pauses the write after its user row lock.
async function pauseWrite(pool: pg.Pool, table: 'sessions' | 'users') {
  await pool.query(`CREATE FUNCTION fixture_pause_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(91723); RETURN NEW; END $$`);
  await pool.query(
    table === 'sessions'
      ? `CREATE TRIGGER fixture_pause BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION fixture_pause_write()`
      : `CREATE TRIGGER fixture_pause BEFORE UPDATE ON users FOR EACH ROW WHEN (NEW.block_reason = 'temporary') EXECUTE FUNCTION fixture_pause_write()`
  );
  const client = await pool.connect();
  await client.query('SELECT pg_advisory_lock(91723)');
  return async () => {
    await client.query('SELECT pg_advisory_unlock(91723)');
    client.release();
  };
}

test('password replacement waits behind in-flight issuance and deletes its committed session', async (t) => {
  const { pool, users, user, proof } = await setup(t);
  const release = await pauseWrite(pool, 'sessions');
  const issuance = users.createSession({ credentialProof: proof });
  let replacement: ReturnType<typeof users.changePassword> | undefined;
  try {
    await waitForLock(pool);
    replacement = users.changePassword({ userId: user.id, currentPassword: PASSWORD, newPassword: NEXT });
    await waitForLock(pool, 2);
  } finally {
    await release();
  }
  const issued = await issuance;
  assert.equal((await replacement)?.status, 'updated');
  assert.equal(await users.getSessionUser(issued.token), null);
  assert.equal((await pool.query('SELECT id FROM sessions')).rowCount, 0);
});

test('moderator temporary update wins first; waiting administrator then commits permanent standing', async (t) => {
  const { pool, user, users, standing } = await setup(t);
  const release = await pauseWrite(pool, 'users');
  const temporary = standing.block({
    userId: user.id,
    until: Date.now() + 60000,
    reason: 'temporary',
    canManage: false
  });
  let permanent: ReturnType<typeof standing.block> | undefined;
  try {
    await waitForLock(pool);
    permanent = standing.block({ userId: user.id, until: null, reason: 'permanent', canManage: true });
    await waitForLock(pool, 2);
  } finally {
    await release();
  }
  assert.equal(await temporary, 'updated');
  assert.equal(await permanent, 'updated');
  const current = await users.getUserById(user.id);
  assert.equal(current?.blockedUntil, null);
  assert.equal(current?.blockReason, 'permanent');
});
