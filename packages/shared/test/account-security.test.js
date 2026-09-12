'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const cjs = require('../src/account-security.js');

const loadEsm = () => import(pathToFileURL(path.join(__dirname, '../src/account-security.mjs')).href);

const USER_AGENTS = Object.freeze([
  {
    name: 'desktop shell',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) VoiceRoom/1.3.3 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36',
    expected: { client: 'VoiceRoom Desktop', os: 'Windows' }
  },
  {
    name: 'Chrome on macOS',
    value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    expected: { client: 'Chrome', os: 'macOS' }
  },
  {
    name: 'Edge on Windows',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0',
    expected: { client: 'Edge', os: 'Windows' }
  },
  {
    name: 'Yandex Browser',
    value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 YaBrowser/25.6.0.0 Safari/537.36',
    expected: { client: 'Яндекс Браузер', os: 'Windows' }
  },
  {
    name: 'Firefox on Linux',
    value: 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0',
    expected: { client: 'Firefox', os: 'Linux' }
  },
  {
    name: 'Chrome on Android',
    value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
    expected: { client: 'Chrome', os: 'Android' }
  },
  {
    name: 'Safari on iPhone',
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    expected: { client: 'Safari', os: 'iOS' }
  },
  { name: 'empty', value: '', expected: { client: '', os: '' } },
  { name: 'not a string', value: { userAgent: 'Chrome/1' }, expected: { client: '', os: '' } }
]);

test('describeUserAgent names the client and OS the same way in CJS and ESM', async () => {
  const esm = await loadEsm();
  for (const fixture of USER_AGENTS) {
    assert.deepEqual(cjs.describeUserAgent(fixture.value), fixture.expected, fixture.name);
    assert.deepEqual(esm.describeUserAgent(fixture.value), fixture.expected, `${fixture.name} (ESM)`);
  }
});

test('normalizeRecoveryCode accepts typed variations and rejects everything else', async () => {
  const esm = await loadEsm();
  const canonical = '0123456789ABCDEF'.replace('C', 'H');
  const cases = [
    ['0123-4567-89AB-HDEF', canonical],
    ['  0123 4567 89ab hdef ', canonical],
    ['O123-4567-89AB-HDEF', canonical],
    ['0I23-4567-89AB-HDEF', '0123456789ABHDEF'],
    ['0L23-4567-89AB-HDEF', '0123456789ABHDEF'],
    ['0123-4567-89AB-HDE', ''],
    ['0123-4567-89AB-HDEFX', ''],
    ['0123-4567-89AB-HDEU', ''],
    ['', ''],
    ['x'.repeat(65), ''],
    [42, '']
  ];
  for (const [input, expected] of cases) {
    assert.equal(cjs.normalizeRecoveryCode(input), expected, String(input));
    assert.equal(esm.normalizeRecoveryCode(input), expected, `${String(input)} (ESM)`);
  }
  assert.equal(cjs.formatRecoveryCode('0123456789abhdef'), '0123-4567-89AB-HDEF');
  assert.equal(cjs.formatRecoveryCode('nope'), '');
});

test('every alphabet symbol survives normalization', () => {
  assert.equal(cjs.RECOVERY_CODE_ALPHABET.length, 32);
  const code = cjs.RECOVERY_CODE_ALPHABET.slice(0, cjs.RECOVERY_CODE_LENGTH);
  assert.equal(cjs.normalizeRecoveryCode(code), code);
  assert.equal(cjs.normalizeRecoveryCode(cjs.RECOVERY_CODE_ALPHABET.slice(16)), cjs.RECOVERY_CODE_ALPHABET.slice(16));
});

test('what is new is compared by release version, not by string order', async () => {
  const esm = await loadEsm();
  assert.equal(cjs.normalizeReleaseVersion(cjs.WHATS_NEW_VERSION), cjs.WHATS_NEW_VERSION);
  assert.equal(esm.WHATS_NEW_VERSION, cjs.WHATS_NEW_VERSION);

  for (const [left, right, expected] of [
    ['2.6.0', '2.6.0', 0],
    ['2.5.8', '2.6.0', -1],
    ['2.10.0', '2.9.9', 1],
    ['10.0.0', '9.99.99', 1],
    ['2.6', '2.6.0', null],
    ['v2.6.0', '2.6.0', null],
    [null, '2.6.0', null]
  ]) {
    assert.equal(cjs.compareReleaseVersions(left, right), expected, `${left} vs ${right}`);
    assert.equal(esm.compareReleaseVersions(left, right), expected, `${left} vs ${right} (ESM)`);
  }

  // Accounts that never recorded an announcement predate every release.
  assert.equal(cjs.hasUnseenWhatsNew(null, '2.6.0'), true);
  assert.equal(cjs.hasUnseenWhatsNew('2.5.0', '2.6.0'), true);
  assert.equal(cjs.hasUnseenWhatsNew('2.6.0', '2.6.0'), false);
  assert.equal(cjs.hasUnseenWhatsNew('2.7.0', '2.6.0'), false);
  assert.equal(cjs.hasUnseenWhatsNew(null, 'not-a-version'), false);
});

test('the recovery codes reminder is due only without codes and outside its snooze', async () => {
  const esm = await loadEsm();
  const now = 1_000_000;
  const later = now + cjs.RECOVERY_CODES_REMINDER_SNOOZE_MS;
  assert.equal(cjs.RECOVERY_CODES_REMINDER_SNOOZE_MS, 3 * 24 * 60 * 60 * 1000);

  for (const [status, reminder, expected] of [
    [{ remaining: 0 }, { snoozedUntil: null }, true],
    [{ remaining: 0 }, { snoozedUntil: now - 1 }, true],
    [{ remaining: 0 }, { snoozedUntil: later }, false],
    [{ remaining: 3 }, { snoozedUntil: null }, false],
    [null, { snoozedUntil: null }, false]
  ]) {
    assert.equal(cjs.isRecoveryCodesReminderDue(status, reminder, now), expected, JSON.stringify([status, reminder]));
    assert.equal(esm.isRecoveryCodesReminderDue(status, reminder, now), expected);
  }
});

test('session rows are validated at the boundary', async () => {
  const esm = await loadEsm();
  const row = {
    id: '6F9619FF-8B86-D011-B42D-00C04FC964FF',
    current: true,
    client: ' Chrome ',
    os: 'Windows',
    location: 'Москва, Россия',
    lastSeenAt: 1_789_000_000_000,
    ip: '203.0.113.7'
  };
  const normalized = cjs.normalizeAccountSession(row);
  assert.deepEqual(normalized, {
    id: '6f9619ff-8b86-d011-b42d-00c04fc964ff',
    current: true,
    client: 'Chrome',
    os: 'Windows',
    location: 'Москва, Россия',
    lastSeenAt: 1_789_000_000_000
  });
  assert.equal('ip' in normalized, false);
  assert.deepEqual(esm.normalizeAccountSession(row), normalized);
  assert.equal(cjs.normalizeAccountSession({ ...row, id: 'not-a-uuid' }), null);
  assert.equal(cjs.normalizeAccountSession({ ...row, lastSeenAt: 'yesterday' }), null);
  assert.equal(cjs.normalizeAccountSession({ ...row, current: 'yes' }).current, false);
});

test('deleted accounts use a reserved login prefix and a fixed name', async () => {
  const esm = await loadEsm();
  assert.equal(cjs.ACCOUNT_DELETION_GRACE_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(esm.DELETED_ACCOUNT_NAME, 'Удалённый аккаунт');
  for (const [login, expected] of [
    ['deleted-1a2b3c4d', true],
    [' Deleted-anything', true],
    ['deleted', false],
    ['undeleted-1', false],
    ['ada', false],
    [null, false]
  ]) {
    assert.equal(cjs.isDeletedAccountLogin(login), expected, String(login));
    assert.equal(esm.isDeletedAccountLogin(login), expected, `${String(login)} (ESM)`);
  }
});

test('login alerts are validated at the boundary', async () => {
  const esm = await loadEsm();
  assert.ok(cjs.LOGIN_ALERT_TTL_MS < cjs.LOGIN_FAMILIARITY_WINDOW_MS);
  const alert = {
    id: '6F9619FF-8B86-D011-B42D-00C04FC964FF',
    kind: 'recovery',
    client: ' Firefox ',
    os: 'Linux',
    location: 'Казань, Россия',
    createdAt: 1_789_000_000_000,
    sessionPublicId: 'must-not-leak'
  };
  const expected = {
    id: '6f9619ff-8b86-d011-b42d-00c04fc964ff',
    kind: 'recovery',
    client: 'Firefox',
    os: 'Linux',
    location: 'Казань, Россия',
    createdAt: 1_789_000_000_000
  };
  assert.deepEqual(cjs.normalizeLoginAlert(alert), expected);
  assert.deepEqual(esm.normalizeLoginAlert(alert), expected);
  assert.equal(cjs.normalizeLoginAlert({ ...alert, kind: 'register' }), null);
  assert.equal(cjs.normalizeLoginAlert({ ...alert, id: 'nope' }), null);
  assert.equal(cjs.normalizeLoginAlert({ ...alert, createdAt: 'today' }), null);
});
