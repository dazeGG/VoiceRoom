'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createUserStore } = require('../src/lib/user-store');
const { runMigrations } = require('../src/lib/migrate');
const { LOGIN_ALERT_TTL_MS, LOGIN_FAMILIARITY_WINDOW_MS } = require('@voice-room/shared/account-security');
const { createTestDatabase } = require('./db-harness');

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const DAY = 24 * 60 * 60 * 1000;
const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const MOSCOW = 'Москва, Россия';
const KAZAN = 'Казань, Россия';

async function createMigratedStore(t) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  await runMigrations({ databaseUrl, logger: SILENT });
  const store = createUserStore({ databaseUrl, logger: SILENT });
  t.after(async () => {
    await store.close();
    await cleanup();
  });
  return store;
}

async function signIn(store, userId, { kind = 'login', userAgent, location = '', now }) {
  const session = await store.createSession({ userId, now, userAgent, locationLabel: location });
  const { alert } = await store.recordLogin({
    userId,
    sessionPublicId: session.publicId,
    kind,
    userAgent,
    locationLabel: location,
    now
  });
  return { session, alert };
}

test('only a device or city the account has not vouched for raises a question', async (t) => {
  const store = await createMigratedStore(t);
  const { user } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  const start = 100 * DAY;

  const laptop = await signIn(store, user.id, { kind: 'register', userAgent: CHROME_WINDOWS, location: MOSCOW, now: start });
  assert.equal(laptop.alert, null, 'registration only sets the baseline');

  const sameLaptop = await signIn(store, user.id, { userAgent: CHROME_WINDOWS, location: MOSCOW, now: start + 1_000 });
  assert.equal(sameLaptop.alert, null, 'the same browser in the same city is familiar');

  const stranger = await signIn(store, user.id, { userAgent: FIREFOX_LINUX, location: KAZAN, now: start + 2_000 });
  assert.deepEqual(stranger.alert, {
    id: stranger.alert.id,
    kind: 'login',
    client: 'Firefox',
    os: 'Linux',
    location: KAZAN,
    createdAt: start + 2_000
  });

  // An unanswered question must not let the same stranger sign in again quietly.
  const strangerAgain = await signIn(store, user.id, { userAgent: FIREFOX_LINUX, location: KAZAN, now: start + 3_000 });
  assert.ok(strangerAgain.alert);

  const sameBrowserElsewhere = await signIn(store, user.id, { userAgent: CHROME_WINDOWS, location: KAZAN, now: start + 4_000 });
  assert.ok(sameBrowserElsewhere.alert, 'a familiar browser in a new city still asks');

  assert.deepEqual(
    (await store.listPendingLoginAlerts({ userId: user.id, excludeSessionPublicId: laptop.session.publicId, now: start + 5_000 }))
      .map((alert) => alert.id),
    [stranger.alert.id, strangerAgain.alert.id, sameBrowserElsewhere.alert.id]
  );
  // A device is never asked about its own sign-in.
  assert.deepEqual(
    (await store.listPendingLoginAlerts({ userId: user.id, excludeSessionPublicId: stranger.session.publicId, now: start + 5_000 }))
      .map((alert) => alert.id),
    [strangerAgain.alert.id, sameBrowserElsewhere.alert.id]
  );
});

test('"Это я" vouches for the device, "Это не я" ends its session and keeps it unfamiliar', async (t) => {
  const store = await createMigratedStore(t);
  const { user } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  const start = 100 * DAY;
  const laptop = await signIn(store, user.id, { kind: 'register', userAgent: CHROME_WINDOWS, location: MOSCOW, now: start });

  const phone = await signIn(store, user.id, { userAgent: SAFARI_IPHONE, location: MOSCOW, now: start + 1_000 });
  assert.deepEqual(
    await store.resolveLoginAlert({
      userId: user.id,
      alertId: phone.alert.id,
      resolution: 'confirmed',
      currentSessionPublicId: phone.session.publicId,
      now: start + 2_000
    }),
    { status: 'not_found', revokedTokenHash: null },
    'the new device cannot vouch for itself'
  );
  assert.deepEqual(
    await store.resolveLoginAlert({
      userId: user.id,
      alertId: phone.alert.id.toUpperCase(),
      resolution: 'confirmed',
      currentSessionPublicId: laptop.session.publicId,
      now: start + 2_000
    }),
    { status: 'resolved', revokedTokenHash: null }
  );
  assert.ok(await store.getSessionUser(phone.session.token, start + 3_000));
  const phoneAgain = await signIn(store, user.id, { userAgent: SAFARI_IPHONE, location: MOSCOW, now: start + 4_000 });
  assert.equal(phoneAgain.alert, null);

  const stranger = await signIn(store, user.id, { userAgent: FIREFOX_LINUX, location: KAZAN, now: start + 5_000 });
  const denied = await store.resolveLoginAlert({
    userId: user.id,
    alertId: stranger.alert.id,
    resolution: 'denied',
    currentSessionPublicId: laptop.session.publicId,
    now: start + 6_000
  });
  assert.deepEqual(denied, { status: 'resolved', revokedTokenHash: stranger.session.tokenHash });
  assert.equal(await store.getSessionUser(stranger.session.token, start + 6_500), null);
  assert.deepEqual(
    await store.resolveLoginAlert({ userId: user.id, alertId: stranger.alert.id, resolution: 'denied', now: start + 7_000 }),
    { status: 'not_found', revokedTokenHash: null },
    'a question is answered once'
  );

  const strangerBack = await signIn(store, user.id, { userAgent: FIREFOX_LINUX, location: KAZAN, now: start + 8_000 });
  assert.ok(strangerBack.alert, 'a denied device stays unfamiliar');
});

test('questions expire, familiarity fades and old sign-ins are pruned', async (t) => {
  const store = await createMigratedStore(t);
  const { user } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  const start = 100 * DAY;
  const laptop = await signIn(store, user.id, { kind: 'register', userAgent: CHROME_WINDOWS, location: MOSCOW, now: start });
  const stranger = await signIn(store, user.id, { userAgent: FIREFOX_LINUX, location: KAZAN, now: start + 1_000 });

  const afterTtl = start + 1_000 + LOGIN_ALERT_TTL_MS + 1;
  assert.deepEqual(await store.listPendingLoginAlerts({ userId: user.id, now: afterTtl }), []);
  assert.deepEqual(
    await store.resolveLoginAlert({
      userId: user.id,
      alertId: stranger.alert.id,
      resolution: 'confirmed',
      currentSessionPublicId: laptop.session.publicId,
      now: afterTtl
    }),
    { status: 'not_found', revokedTokenHash: null }
  );

  // Sessions last 30 days by default, so past the window nothing vouches anymore.
  const later = start + LOGIN_FAMILIARITY_WINDOW_MS + DAY;
  const laptopLater = await signIn(store, user.id, { userAgent: CHROME_WINDOWS, location: MOSCOW, now: later });
  assert.ok(laptopLater.alert, 'a sign-in older than the window no longer vouches for the device');

  assert.equal(await store.pruneLoginEvents(start + 91 * DAY), 2);
  assert.equal(await store.pruneLoginEvents(start + 91 * DAY), 0);
});

test('unknown questions and answers are refused', async (t) => {
  const store = await createMigratedStore(t);
  const { user } = await store.createUser({ login: 'ada', password: 'lovelace-1843' });
  assert.deepEqual(
    await store.resolveLoginAlert({ userId: user.id, alertId: 'not-an-id', resolution: 'confirmed' }),
    { status: 'not_found', revokedTokenHash: null }
  );
  assert.deepEqual(
    await store.resolveLoginAlert({ userId: user.id, alertId: '6f9619ff-8b86-d011-b42d-00c04fc964ff', resolution: 'maybe' }),
    { status: 'not_found', revokedTokenHash: null }
  );
});
