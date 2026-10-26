import assert from 'node:assert/strict';
import test from 'node:test';

import { Value } from 'typebox/value';

import * as accountSecurity from '../src/account-security.ts';
import { AccountSession, LoginAlert } from '../src/contracts/account.ts';
import { ClientKind } from '../src/contracts/admin.ts';
import { defined } from './helpers/assert-defined.ts';

const USER_AGENTS = Object.freeze([
  {
    name: 'desktop shell',
    value:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) VoiceRoom/1.3.3 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36',
    expected: { client: 'VoiceRoom Desktop', os: 'Windows' }
  },
  {
    name: 'Chrome on macOS',
    value:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    expected: { client: 'Chrome', os: 'macOS' }
  },
  {
    name: 'Edge on Windows',
    value:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0',
    expected: { client: 'Edge', os: 'Windows' }
  },
  {
    name: 'Yandex Browser',
    value:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 YaBrowser/25.6.0.0 Safari/537.36',
    expected: { client: 'Яндекс Браузер', os: 'Windows' }
  },
  {
    name: 'Firefox on Linux',
    value: 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0',
    expected: { client: 'Firefox', os: 'Linux' }
  },
  {
    name: 'Chrome on Android',
    value:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
    expected: { client: 'Chrome', os: 'Android' }
  },
  {
    name: 'Safari on iPhone',
    value:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
    expected: { client: 'Safari', os: 'iOS' }
  },
  { name: 'empty', value: '', expected: { client: '', os: '' } },
  { name: 'not a string', value: { userAgent: 'Chrome/1' }, expected: { client: '', os: '' } }
]);

test('describeUserAgent names the client and OS', async () => {
  for (const fixture of USER_AGENTS) {
    assert.deepEqual(accountSecurity.describeUserAgent(fixture.value), fixture.expected, fixture.name);
  }
});

test('isDesktopAppUserAgent agrees with the described client', async () => {
  for (const fixture of USER_AGENTS) {
    const expected = fixture.expected.client === 'VoiceRoom Desktop';
    assert.equal(accountSecurity.isDesktopAppUserAgent(fixture.value), expected, fixture.name);
  }
  // Repeated calls must not carry regex state between user agents.
  const shell = defined(USER_AGENTS[0], 'the first user agent').value;
  assert.equal(accountSecurity.isDesktopAppUserAgent(shell), true);
  assert.equal(accountSecurity.isDesktopAppUserAgent(shell), true);
});

test('normalizeRecoveryCode accepts typed variations and rejects everything else', async () => {
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
    assert.equal(accountSecurity.normalizeRecoveryCode(input), expected, String(input));
  }
  assert.equal(accountSecurity.formatRecoveryCode('0123456789abhdef'), '0123-4567-89AB-HDEF');
  assert.equal(accountSecurity.formatRecoveryCode('nope'), '');
});

test('every alphabet symbol survives normalization', () => {
  assert.equal(accountSecurity.RECOVERY_CODE_ALPHABET.length, 32);
  const code = accountSecurity.RECOVERY_CODE_ALPHABET.slice(0, accountSecurity.RECOVERY_CODE_LENGTH);
  assert.equal(accountSecurity.normalizeRecoveryCode(code), code);
  assert.equal(
    accountSecurity.normalizeRecoveryCode(accountSecurity.RECOVERY_CODE_ALPHABET.slice(16)),
    accountSecurity.RECOVERY_CODE_ALPHABET.slice(16)
  );
});

test('what is new is compared by release version, not by string order', async () => {
  assert.equal(
    accountSecurity.normalizeReleaseVersion(accountSecurity.WHATS_NEW_VERSION),
    accountSecurity.WHATS_NEW_VERSION
  );

  // A malformed last-seen version counts as never seen.
  for (const [lastSeen, current, expected] of [
    ['2.6.0', '2.6.0', false],
    ['2.5.8', '2.6.0', true],
    ['2.10.0', '2.9.9', false],
    ['2.9.9', '2.10.0', true],
    ['10.0.0', '9.99.99', false],
    ['2.6', '2.6.0', true],
    ['v2.6.0', '2.6.0', true]
  ] as const) {
    assert.equal(accountSecurity.hasUnseenWhatsNew(lastSeen, current), expected, `${lastSeen} vs ${current}`);
  }

  // Accounts that never recorded an announcement predate every release.
  assert.equal(accountSecurity.hasUnseenWhatsNew(null, '2.6.0'), true);
  assert.equal(accountSecurity.hasUnseenWhatsNew('2.5.0', '2.6.0'), true);
  assert.equal(accountSecurity.hasUnseenWhatsNew('2.6.0', '2.6.0'), false);
  assert.equal(accountSecurity.hasUnseenWhatsNew('2.7.0', '2.6.0'), false);
  assert.equal(accountSecurity.hasUnseenWhatsNew(null, 'not-a-version'), false);
});

test('the recovery codes reminder is due only without codes and outside its snooze', async () => {
  const now = 1_000_000;
  const later = now + accountSecurity.RECOVERY_CODES_REMINDER_SNOOZE_MS;
  assert.equal(accountSecurity.RECOVERY_CODES_REMINDER_SNOOZE_MS, 3 * 24 * 60 * 60 * 1000);

  const cases: [
    Parameters<typeof accountSecurity.isRecoveryCodesReminderDue>[0],
    Parameters<typeof accountSecurity.isRecoveryCodesReminderDue>[1],
    boolean
  ][] = [
    [{ remaining: 0 }, { snoozedUntil: null }, true],
    [{ remaining: 0 }, { snoozedUntil: now - 1 }, true],
    [{ remaining: 0 }, { snoozedUntil: later }, false],
    [{ remaining: 3 }, { snoozedUntil: null }, false],
    [null, { snoozedUntil: null }, false]
  ];
  for (const [status, reminder, expected] of cases) {
    assert.equal(
      accountSecurity.isRecoveryCodesReminderDue(status, reminder, now),
      expected,
      JSON.stringify([status, reminder])
    );
  }
});

test('deleted accounts use a reserved login prefix and a fixed name', async () => {
  assert.equal(accountSecurity.ACCOUNT_DELETION_GRACE_MS, 7 * 24 * 60 * 60 * 1000);
  for (const [login, expected] of [
    ['deleted-1a2b3c4d', true],
    [' Deleted-anything', true],
    ['deleted', false],
    ['undeleted-1', false],
    ['ada', false],
    [null, false]
  ]) {
    assert.equal(accountSecurity.isDeletedAccountLogin(login), expected, String(login));
  }
});

test('a login alert expires before the familiarity window ends', () => {
  assert.ok(accountSecurity.LOGIN_ALERT_TTL_MS < accountSecurity.LOGIN_FAMILIARITY_WINDOW_MS);
});

test('session and alert times are always numbers, as the API sends them', () => {
  const session = { id: 's', current: true, client: '', os: '', location: '', lastSeenAt: 1 };
  assert.equal(Value.Check(AccountSession, session), true);
  assert.equal(Value.Check(AccountSession, { ...session, lastSeenAt: null }), false);
  const alert = { id: 'a', kind: 'login', client: '', os: '', location: '', createdAt: 1 };
  assert.equal(Value.Check(LoginAlert, alert), true);
  assert.equal(Value.Check(LoginAlert, { ...alert, createdAt: null }), false);
});

test('clientKind answers only kinds the admin contract accepts', () => {
  for (const fixture of USER_AGENTS) {
    const kind = accountSecurity.clientKind(typeof fixture.value === 'string' ? fixture.value : null);
    if (kind !== null) assert.equal(Value.Check(ClientKind, kind), true, fixture.name);
  }
  assert.equal(Value.Check(ClientKind, 'tablet'), false);
});
