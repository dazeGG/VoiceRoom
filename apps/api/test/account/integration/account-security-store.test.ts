import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { createUserStore } from '../../../src/app/user-store.ts';
import { runMigrations } from '../../../src/lib/migrate.ts';
import { RECOVERY_CODES_REMINDER_SNOOZE_MS, normalizeRecoveryCode } from '@voiceroom/shared/account-security';
import { createTestDatabase } from '../../db-harness.ts';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const HOUR = 60 * 60 * 1000;
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0';

async function createMigratedStore(t: TestContext, options: Partial<Parameters<typeof createUserStore>[0]> = {}) {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const store = createUserStore({ pool, logger: SILENT, ...options });
  t.after(async () => {
    await cleanup();
  });
  return store;
}

async function waitFor<T>(read: () => Promise<T>, timeoutMs = 3000): Promise<NonNullable<T>> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error('Condition was not reached in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('sessions record their device and list newest first without exposing token hashes', async (t) => {
  const store = await createMigratedStore(t);
  const { user } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  assert.ok(user);

  const laptop = await store.createSession({
    credentialProof: { userId: user.id, passwordHash: user.passwordHash },
    now: 1_000,
    userAgent: CHROME_WINDOWS,
    locationLabel: 'Москва, Россия'
  });
  const desktop = await store.createSession({
    credentialProof: { userId: user.id, passwordHash: user.passwordHash },
    now: 2_000,
    userAgent: FIREFOX_LINUX
  });

  const sessions = await store.listSessions({ userId: user.id, currentTokenHash: laptop.tokenHash, now: 3_000 });
  assert.deepEqual(
    sessions.map((session) => session.id),
    [desktop.publicId, laptop.publicId]
  );
  assert.deepEqual(sessions[1], {
    id: laptop.publicId,
    current: true,
    client: 'Chrome',
    os: 'Windows',
    location: 'Москва, Россия',
    lastSeenAt: 1_000
  });
  assert.equal(sessions[0]?.current, false);
  assert.equal(sessions[0]?.location, '');
  assert.equal(JSON.stringify(sessions).includes(laptop.tokenHash), false);

  const resolved = await store.getSessionUser(laptop.token, 1_500);
  assert.ok(resolved);
  assert.equal(resolved.session.publicId, laptop.publicId);
  assert.equal(resolved.session.tokenHash, laptop.tokenHash);
});

test('the hourly touch refreshes the device but keeps a known location when a lookup finds nothing', async (t) => {
  const store = await createMigratedStore(t);
  const { user } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  assert.ok(user);
  const session = await store.createSession({
    credentialProof: { userId: user.id, passwordHash: user.passwordHash },
    now: 0,
    userAgent: CHROME_WINDOWS,
    locationLabel: 'Казань, Россия'
  });

  let lookups = 0;
  const resolveLocation = async () => {
    lookups += 1;
    return '';
  };

  // Inside the hour the session is not rewritten, so no lookup happens either.
  await store.getSessionUser(session.token, HOUR / 2, { userAgent: FIREFOX_LINUX, resolveLocation });
  assert.equal(lookups, 0);

  await store.getSessionUser(session.token, 2 * HOUR, { userAgent: FIREFOX_LINUX, resolveLocation });
  const touched = await waitFor(async () => {
    const [row] = await store.listSessions({ userId: user.id, now: 2 * HOUR });
    return row?.lastSeenAt === 2 * HOUR ? row : null;
  });
  assert.equal(lookups, 1);
  assert.equal(touched.client, 'Firefox');
  assert.equal(touched.os, 'Linux');
  assert.equal(touched.location, 'Казань, Россия');
});

test('revoking a session touches only that account and reports the revoked token hashes', async (t) => {
  const store = await createMigratedStore(t);
  const { user } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  assert.ok(user);
  const { user: other } = await store.createUser({ login: 'grace', password: 'cobol-1959' });
  assert.ok(other);

  const first = await store.createSession({
    credentialProof: { userId: user.id, passwordHash: user.passwordHash },
    now: 1_000
  });
  const second = await store.createSession({
    credentialProof: { userId: user.id, passwordHash: user.passwordHash },
    now: 1_000
  });
  const foreign = await store.createSession({
    credentialProof: { userId: other.id, passwordHash: other.passwordHash },
    now: 1_000
  });

  assert.deepEqual(await store.revokeSession({ userId: other.id, publicId: first.publicId }), {
    status: 'not_found',
    tokenHash: null
  });
  assert.deepEqual(await store.revokeSession({ userId: user.id, publicId: 'not-a-session-id' }), {
    status: 'not_found',
    tokenHash: null
  });
  assert.deepEqual(await store.revokeSession({ userId: user.id, publicId: first.publicId.toUpperCase() }), {
    status: 'revoked',
    tokenHash: first.tokenHash
  });
  assert.equal(await store.getSessionUser(first.token, 5_000), null);
  assert.ok(await store.getSessionUser(second.token, 5_000));

  const current = await store.createSession({
    credentialProof: { userId: user.id, passwordHash: user.passwordHash },
    now: 1_000
  });
  const others = await store.revokeOtherSessions({ userId: user.id, keepTokenHash: current.tokenHash });
  assert.deepEqual(others.tokenHashes, [second.tokenHash]);
  assert.ok(await store.getSessionUser(current.token, 5_000));
  assert.ok(await store.getSessionUser(foreign.token, 5_000));
});

test('recovery codes are handed out once, work once and replace the password everywhere', async (t) => {
  const store = await createMigratedStore(t);
  const { user } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  assert.ok(user);
  assert.deepEqual(await store.getRecoveryCodesStatus(user.id), { remaining: 0, generatedAt: null });

  const refused = await store.generateRecoveryCodes({
    userId: user.id,
    currentPassword: 'not-the-password',
    now: 1_000
  });
  assert.deepEqual(refused, { status: 'invalid_password', codes: [] });

  const generated = await store.generateRecoveryCodes({
    userId: user.id,
    currentPassword: 'lovelace-1843',
    now: 1_000
  });
  assert.equal(generated.status, 'generated');
  assert.equal(generated.codes.length, 10);
  assert.equal(new Set(generated.codes).size, 10);
  for (const code of generated.codes) assert.equal(normalizeRecoveryCode(code), code);
  assert.deepEqual(await store.getRecoveryCodesStatus(user.id), { remaining: 10, generatedAt: 1_000 });

  const session = await store.createSession({
    credentialProof: { userId: user.id, passwordHash: user.passwordHash },
    now: 1_000
  });
  const [first, second] = generated.codes;
  assert.ok(first);

  assert.equal(
    (await store.recoverWithCode({ login: 'ghost', code: first, newPassword: 'new-password-1' })).status,
    'invalid'
  );
  assert.equal(
    (await store.recoverWithCode({ login: 'ada', code: 'not a code', newPassword: 'new-password-1' })).status,
    'invalid'
  );
  assert.equal(
    (await store.recoverWithCode({ login: 'ada', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', newPassword: 'new-password-1' })).status,
    'invalid'
  );
  assert.ok(await store.verifyCredentials('ada', 'lovelace-1843'), 'failed attempts must not touch the password');

  // Codes survive being typed in lower case and split into groups.
  const typed = first.toLowerCase().replace(/(.{4})/g, '$1 ');
  const recovered = await store.recoverWithCode({
    login: 'ada',
    code: typed,
    newPassword: 'new-password-1',
    now: 2_000
  });
  assert.ok(recovered.user);
  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.user.id, user.id);
  assert.equal(recovered.remaining, 9);
  assert.equal(await store.getSessionUser(session.token, 2_500), null);
  assert.equal(await store.verifyCredentials('ada', 'lovelace-1843'), null);
  assert.ok(await store.verifyCredentials('ada', 'new-password-1'));

  const reused = await store.recoverWithCode({ login: 'ada', code: first, newPassword: 'new-password-2' });
  assert.equal(reused.status, 'invalid');

  // A new set replaces the old one entirely.
  const regenerated = await store.generateRecoveryCodes({
    userId: user.id,
    currentPassword: 'new-password-1',
    now: 3_000
  });
  assert.ok(regenerated.status === 'generated');
  assert.equal(regenerated.codes.includes(String(second)), false);
  assert.equal(
    (await store.recoverWithCode({ login: 'ada', code: second, newPassword: 'new-password-2' })).status,
    'invalid'
  );
  assert.deepEqual(await store.getRecoveryCodesStatus(user.id), { remaining: 10, generatedAt: 3_000 });
});

test('a recovery code only opens the account it was issued for', async (t) => {
  const store = await createMigratedStore(t);
  const { user: ada } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  assert.ok(ada);
  await store.createUser({ login: 'grace', password: 'cobol-1959' });
  const { codes } = await store.generateRecoveryCodes({ userId: ada.id, currentPassword: 'lovelace-1843' });

  const crossed = await store.recoverWithCode({ login: 'grace', code: codes[0], newPassword: 'taken-over-1' });
  assert.equal(crossed.status, 'invalid');
  assert.ok(await store.verifyCredentials('grace', 'cobol-1959'));
  assert.deepEqual((await store.getRecoveryCodesStatus(ada.id)).remaining, 10);
});

test('announcement acknowledgements only advance and the codes reminder snoozes for three days', async (t) => {
  const { cleanup, databaseUrl, pool } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const store = createUserStore({ pool, logger: SILENT });
  t.after(async () => {
    await cleanup();
  });
  const { user } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  assert.ok(user);

  const { rows } = await pool.query<{ has_seen: boolean }>(
    `SELECT metadata ? 'whatsNewSeen' AS has_seen FROM users WHERE id = $1`,
    [user.id]
  );
  assert.equal(rows[0]?.has_seen, false);
  assert.deepEqual(await store.getAccountNotices(user.id), {
    whatsNewSeen: null,
    recoveryCodesReminderSnoozedUntil: null
  });

  await pool.query(`UPDATE users SET metadata = '{"whatsNewSeen":"2.8.0"}'::jsonb WHERE id = $1`, [user.id]);
  assert.deepEqual(await store.getAccountNotices(user.id), {
    whatsNewSeen: '2.8.0',
    recoveryCodesReminderSnoozedUntil: null
  });
  assert.deepEqual(await store.markWhatsNewSeen({ userId: user.id }), {
    status: 'seen',
    whatsNewSeen: '2.8.0'
  });
  assert.deepEqual(await store.markWhatsNewSeen({ userId: user.id, release: 'web/1.5.0', now: 500 }), {
    status: 'seen',
    whatsNewSeen: 'web/1.5.0'
  });
  for (const release of ['web/1.4.9', 'web/1.5.0']) {
    assert.deepEqual(await store.markWhatsNewSeen({ userId: user.id, release, now: 800 }), {
      status: 'seen',
      whatsNewSeen: 'web/1.5.0'
    });
  }
  const { rows: updated } = await pool.query<{ updated_at: Date }>('SELECT updated_at FROM users WHERE id = $1', [
    user.id
  ]);
  assert.equal(updated[0]?.updated_at.getTime(), 500);
  assert.deepEqual(await store.snoozeRecoveryCodesReminder({ userId: user.id, now: 1_000 }), {
    status: 'snoozed',
    snoozedUntil: 1_000 + RECOVERY_CODES_REMINDER_SNOOZE_MS
  });
  assert.deepEqual(await store.getAccountNotices(user.id), {
    whatsNewSeen: 'web/1.5.0',
    recoveryCodesReminderSnoozedUntil: 1_000 + 3 * 24 * HOUR
  });

  await Promise.all([
    store.markWhatsNewSeen({ userId: user.id, release: 'web/1.10.0' }),
    store.markWhatsNewSeen({ userId: user.id, release: 'web/1.9.9' })
  ]);
  assert.equal((await store.getAccountNotices(user.id)).whatsNewSeen, 'web/1.10.0');

  const ghost = crypto.randomUUID();
  assert.deepEqual(await store.markWhatsNewSeen({ userId: ghost }), { status: 'not_found', whatsNewSeen: null });
  assert.deepEqual(await store.snoozeRecoveryCodesReminder({ userId: ghost }), {
    status: 'not_found',
    snoozedUntil: null
  });
});
