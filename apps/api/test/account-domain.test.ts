// Branch-by-branch proofs for accounts (domains/account): the service on a
// fake user store, the /api/auth routes on a bare Fastify app, and the
// session cookie. The HTTP suites (auth, account-*-http) cover the database.

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fastify, { type FastifyInstance } from 'fastify';

import {
  createAccountService,
  type AccountDeletionRepository,
  type AccountService,
  type AccountUserStore
} from '../src/domains/account/account.service.ts';
import { registerAccountRoutes } from '../src/domains/account/account.routes.ts';
import { createSessionCookies, parseCookies } from '../src/domains/account/session-cookie.ts';
import type { ApiContext } from '../src/app/context.ts';
import { registerHttpKit } from '../src/platform/http/http-kit.ts';
import { fake, recordingLogger, storedUser, publicUser, loginAlert } from './fakes/index.ts';

const DEVICE = { userAgent: 'UA', locationLabel: 'Berlin' };
const device = async () => DEVICE;
const USER = storedUser({ id: 'user-1', login: 'alice', displayName: 'Alice' });
const ALERT = { id: 'a1', kind: 'login' as const, client: '', os: '', location: '', createdAt: 1 };
const SESSION = { id: 'pub-1', current: true, client: '', os: '', location: '', lastSeenAt: 1 };

// --- session cookie -------------------------------------------------------------

test('the session cookie is HttpOnly, Lax, Secure when asked and tolerant when read', () => {
  const secure = createSessionCookies({ name: 'vr_session', secure: true, maxAgeSeconds: 90.7 });
  assert.equal(secure.issue('a b'), 'vr_session=a%20b; Path=/; HttpOnly; SameSite=Lax; Max-Age=90; Secure');
  assert.equal(secure.clear(), 'vr_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure');
  const plain = createSessionCookies({ name: 'vr_session', secure: false, maxAgeSeconds: -5 });
  assert.equal(plain.issue('t'), 'vr_session=t; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  assert.equal(plain.read({ headers: { cookie: 'x=1; vr_session=tok%21; =bad; broken; y=%E0%A4%A' } }), 'tok!');
  assert.equal(plain.read({ headers: {} }), '');
  assert.deepEqual(parseCookies(null), {});
  assert.deepEqual(parseCookies({ headers: { cookie: 'a=1; b=%zz' } }), { a: '1' });
});

// --- service ----------------------------------------------------------------------

function harness(
  overrides: Partial<AccountUserStore> = {},
  {
    deletions = {},
    noDeletions = false
  }: { deletions?: Partial<AccountDeletionRepository>; noDeletions?: boolean } = {}
) {
  const logger = recordingLogger();
  const calls = {
    ended: [] as Array<{ userId?: string | null; tokenHashes?: string[] | null }>,
    notified: [] as unknown[],
    pushes: [] as string[],
    refreshed: [] as string[],
    broadcast: [] as string[],
    sessions: [] as unknown[],
    reset: [] as string[],
    get errors() {
      return logger.records.filter((record) => record.level === 'error').map((record) => record.evt);
    }
  };
  const users: AccountUserStore = {
    async createUser(input) {
      return input.login === 'taken'
        ? { status: 'login_taken' }
        : { status: 'created', user: storedUser({ id: 'new-1', login: input.login }) };
    },
    async createSession(input) {
      calls.sessions.push(input);
      return { token: 'tok', publicId: 'pub-1' };
    },
    async getUserById(userId) {
      return storedUser({ id: userId, login: 'reloaded', displayName: 'Reloaded' });
    },
    async verifyCredentials(login, password) {
      return password === 'right-password' ? { ...USER, deletionRequestedAt: login === 'leaving' ? 1000 : null } : null;
    },
    async deleteSession() {},
    async updateDisplayName({ userId, displayName }) {
      return userId === 'gone' ? null : storedUser({ id: userId, displayName });
    },
    async changePassword({ userId, currentPassword }) {
      return {
        status: userId === 'gone' ? 'not_found' : currentPassword === 'right-password' ? 'changed' : 'invalid_password'
      };
    },
    async getRecoveryCodesStatus() {
      return { remaining: 3, generatedAt: null };
    },
    async getAccountNotices() {
      return { recoveryCodesReminderSnoozedUntil: 5, whatsNewSeen: '2.6.0' };
    },
    async snoozeRecoveryCodesReminder({ userId }) {
      return userId === 'gone' ? { status: 'not_found', snoozedUntil: null } : { status: 'snoozed', snoozedUntil: 9 };
    },
    async markWhatsNewSeen({ userId }) {
      return userId === 'gone'
        ? { status: 'not_found', whatsNewSeen: null }
        : { status: 'seen', whatsNewSeen: '9.9.9' };
    },
    async markAppPromptSeen({ userId }) {
      return { status: userId === 'gone' ? 'not_found' : 'seen' };
    },
    async listPendingLoginAlerts() {
      return [ALERT];
    },
    async resolveLoginAlert({ alertId, resolution }) {
      return alertId === 'missing'
        ? { status: 'not_found' }
        : { status: 'resolved', revokedTokenHash: resolution === 'denied' ? 'hash-x' : null };
    },
    async listSessions() {
      return [SESSION];
    },
    async revokeSession({ publicId }) {
      return publicId === 'other' ? { status: 'revoked', tokenHash: 'hash-o' } : { status: 'not_found' };
    },
    async revokeOtherSessions() {
      return { tokenHashes: ['h1', 'h2'] };
    },
    async generateRecoveryCodes({ userId, currentPassword }) {
      if (userId === 'gone') return { status: 'not_found', codes: [] };
      return currentPassword === 'right-password'
        ? { status: 'generated', codes: ['aaaabbbbcccc'], generatedAt: 7 }
        : { status: 'invalid_password', codes: [] };
    },
    async recoverWithCode({ code }) {
      return code === 'good' ? { status: 'recovered', user: storedUser(), remaining: 4 } : { status: 'invalid' };
    },
    async recordLogin({ kind }) {
      if (kind === 'register') throw new Error('audit down');
      return {
        alert:
          kind === 'recovery'
            ? loginAlert('alert-1', { kind: 'recovery', client: 'Firefox', os: 'Linux', location: 'Berlin' })
            : kind === 'login'
              ? loginAlert('alert-2')
              : null
      };
    },
    ...overrides
  };
  const requests: Record<string, { status: string; scheduledFor?: number }> = {
    'right-password': { status: 'requested', scheduledFor: 99 },
    again: { status: 'already_requested', scheduledFor: 88 },
    missing: { status: 'not_found' }
  };
  const restores: Record<string, { status: string; userId: string | null }> = {
    ok: { status: 'restored', userId: 'user-1' },
    old: { status: 'expired', userId: null }
  };
  const repository: AccountDeletionRepository = {
    async isLoginReserved(login) {
      return login === 'reserved';
    },
    async previewDeletion() {
      return { graceDays: 7, rooms: [] };
    },
    async requestDeletion({ currentPassword }) {
      return requests[currentPassword] ?? { status: 'invalid_password' };
    },
    async restoreAccount({ login }) {
      return restores[login] ?? { status: 'invalid', userId: null };
    },
    ...deletions
  };
  const service = createAccountService({
    users: () => users,
    deletions: () => (noDeletions ? null : repository),
    loginFailures: {
      reserve: (key) =>
        key === 'locked'
          ? { allowed: false, retryAfterSeconds: 30 }
          : key === 'locked-nowait'
            ? { allowed: false }
            : { allowed: true },
      reset: (key) => calls.reset.push(key)
    },
    endSessionConnections: async (input) => {
      calls.ended.push(input);
    },
    notifyUser: (userId, event) => calls.notified.push(event.type),
    queuePush: async (userId, payload) => {
      calls.pushes.push(payload.title);
    },
    refreshActiveProfile: (user) => calls.refreshed.push(user.id),
    broadcastProfileToFriends: async (user) => {
      calls.broadcast.push(user.id);
    },
    logger: () => logger
  });
  return { calls, service };
}

test('registration validates, keeps deleted logins taken and survives a failed sign-in record', async () => {
  const { calls, service } = harness();
  const base = {
    login: 'bob',
    displayName: 'Bob',
    password: 'long-password',
    passwordConfirm: 'long-password',
    device
  };
  assert.equal((await service.register({ ...base, login: '' })).status, 'invalid_login');
  assert.equal(
    (await service.register({ ...base, password: 'short', passwordConfirm: 'short' })).status,
    'invalid_password'
  );
  assert.equal((await service.register({ ...base, passwordConfirm: 'other-password' })).status, 'password_mismatch');
  assert.equal((await service.register({ ...base, login: 'reserved' })).status, 'login_taken');
  assert.equal((await service.register({ ...base, login: 'taken' })).status, 'login_taken');
  const created = await service.register(base);
  assert.equal(created.status, 'signed_in');
  assert.equal(created.token, 'tok');
  assert.equal(created.user?.login, 'reloaded');
  assert.deepEqual(calls.sessions[0], { userId: 'new-1', ...DEVICE });
  assert.equal(calls.errors.length, 1);
  assert.equal((await harness({}, { noDeletions: true }).service.register(base)).status, 'signed_in');
});

test('sign-in checks credentials, throttles per login and offers a restore to pending deletions', async () => {
  const { calls, service } = harness();
  assert.equal((await service.login({ login: '', password: 'x', device })).status, 'invalid_credentials');
  assert.equal((await service.login({ login: 'alice', password: '', device })).status, 'invalid_credentials');
  assert.deepEqual(await service.login({ login: 'locked', password: 'x', device }), {
    status: 'throttled',
    retryAfterSeconds: 30
  });
  assert.deepEqual(await service.login({ login: 'locked-nowait', password: 'x', device }), {
    status: 'throttled',
    retryAfterSeconds: 0
  });
  assert.equal((await service.login({ login: 'alice', password: 'wrong', device })).status, 'invalid_credentials');
  assert.deepEqual(calls.reset, []);
  const pending = await service.login({ login: 'leaving', password: 'right-password', device });
  assert.equal(pending.status, 'deletion_pending');
  assert.ok(pending.deletionScheduledFor > 1000);
  const ok = await service.login({ login: 'alice', password: 'right-password', device });
  assert.equal(ok.status, 'signed_in');
  assert.deepEqual(calls.reset, ['leaving', 'alice']);
  assert.deepEqual(calls.notified, ['account.login.new']);
  assert.deepEqual(calls.pushes, ['Новый вход в аккаунт']);
});

test('sign-out ends the session and what it holds open', async () => {
  const { calls, service } = harness();
  await service.logout('');
  assert.equal(calls.ended.length, 0);
  await service.logout('tok');
  assert.equal(calls.ended[0]?.tokenHashes?.length, 1);
});

test('profile, password, notices and recovery codes', async () => {
  const { calls, service } = harness();
  assert.equal((await service.updateProfile('gone', 'X')).status, 'not_found');
  assert.equal((await service.updateProfile('user-1', 'New')).status, 'updated');
  assert.deepEqual([calls.refreshed, calls.broadcast], [['user-1'], ['user-1']]);

  assert.equal((await service.changePassword('user-1', 'x', 'short')).status, 'invalid_new_password');
  assert.equal((await service.changePassword('gone', 'x', 'long-password')).status, 'not_found');
  assert.equal((await service.changePassword('user-1', 'wrong', 'long-password')).status, 'invalid_password');
  assert.equal((await service.changePassword('user-1', 'right-password', 'long-password')).status, 'changed');
  assert.deepEqual(calls.ended.at(-1), { userId: 'user-1' });

  assert.deepEqual(await service.security('user-1'), {
    recoveryCodes: { remaining: 3, generatedAt: null },
    recoveryCodesReminder: { snoozedUntil: 5 }
  });
  assert.deepEqual(await service.snoozeRecoveryCodesReminder('user-1'), { status: 'snoozed', snoozedUntil: 9 });
  assert.equal((await service.snoozeRecoveryCodesReminder('gone')).status, 'not_found');
  assert.equal((await service.whatsNew('user-1')).lastSeen, '2.6.0');
  const seen = await service.markWhatsNewSeen('user-1');
  assert.ok('whatsNew' in seen);
  assert.equal(seen.whatsNew.lastSeen, '9.9.9');
  assert.equal((await service.markWhatsNewSeen('gone')).status, 'not_found');
  assert.equal((await service.markAppPromptSeen('user-1')).status, 'seen');
  assert.equal((await service.markAppPromptSeen('gone')).status, 'not_found');

  assert.equal((await service.generateRecoveryCodes('gone', 'x')).status, 'not_found');
  assert.equal((await service.generateRecoveryCodes('user-1', 'wrong')).status, 'invalid_password');
  const generated = await service.generateRecoveryCodes('user-1', 'right-password');
  assert.ok('codes' in generated);
  assert.equal(generated.recoveryCodes.remaining, 1);
  assert.equal(generated.codes.length, 1);
  const empty = await harness({
    async generateRecoveryCodes() {
      return { status: 'generated', codes: [] };
    }
  }).service.generateRecoveryCodes('user-1', 'p');
  assert.ok('codes' in empty);
  assert.deepEqual(empty.codes, []);
});

test('sessions and sign-in alerts', async () => {
  const { calls, service } = harness();
  assert.deepEqual(await service.listSessions('user-1', 'hash'), [SESSION]);
  assert.deepEqual(await service.loginAlerts('user-1', 'pub-1'), [ALERT]);
  assert.equal((await service.revokeSession('user-1', 'PUB-1', 'pub-1')).status, 'current_session');
  assert.equal((await service.revokeSession('user-1', 'pub-1', 42)).status, 'not_found');
  assert.equal((await service.revokeSession('user-1', 'pub-1', 'other')).status, 'revoked');
  assert.deepEqual(calls.ended.at(-1), { userId: 'user-1', tokenHashes: ['hash-o'] });
  assert.equal(await service.revokeOtherSessions('user-1', 'keep'), 2);

  assert.equal((await service.resolveLoginAlert('user-1', 'pub-1', 'missing', 'confirmed')).status, 'not_found');
  assert.deepEqual(await service.resolveLoginAlert('user-1', 'pub-1', 'A1', 'confirmed'), {
    status: 'resolved',
    resolution: 'confirmed'
  });
  assert.deepEqual(await service.resolveLoginAlert('user-1', 'pub-1', 'A1', 'denied'), {
    status: 'resolved',
    resolution: 'denied',
    sessionEnded: true,
    recoveryCodes: { remaining: 3, generatedAt: null }
  });
  assert.deepEqual(calls.ended.at(-1), { userId: 'user-1', tokenHashes: ['hash-x'] });
  assert.deepEqual(calls.notified, ['account.login.resolved', 'account.login.resolved']);
});

test('recovery replaces the password, ends other sessions and asks the other devices', async () => {
  const { calls, service } = harness();
  assert.equal(
    (await service.recover({ login: 'alice', code: 'good', newPassword: 'short', device })).status,
    'invalid_new_password'
  );
  assert.equal(
    (await service.recover({ login: 'alice', code: 'bad', newPassword: 'long-password', device })).status,
    'invalid_code'
  );
  const recovered = await service.recover({ login: 'alice', code: 'good', newPassword: 'long-password', device });
  assert.equal(recovered.status, 'signed_in');
  assert.equal(recovered.remaining, 4);
  assert.deepEqual(calls.ended, [{ userId: 'user-1' }]);
  assert.deepEqual(calls.pushes, ['Вход по коду восстановления']);
  const noRemaining = await harness({
    async recoverWithCode() {
      return { status: 'recovered', user: storedUser({ id: 'u' }) };
    }
  }).service.recover({ login: 'a', code: 'c', newPassword: 'long-password', device });
  assert.ok('remaining' in noRemaining);
  assert.equal(noRemaining.remaining, 0);
});

test('account deletion: preview, request, restore', async () => {
  const off = harness({}, { noDeletions: true }).service;
  assert.equal(off.deletionAvailable(), false);
  assert.equal((await off.deletionPreview('user-1')).status, 'unavailable');
  assert.equal((await off.requestDeletion('user-1', 'x')).status, 'unavailable');

  const { calls, service } = harness();
  assert.equal(service.deletionAvailable(), true);
  assert.deepEqual(await service.deletionPreview('user-1'), {
    status: 'preview',
    preview: { graceDays: 7, rooms: [] }
  });
  assert.equal((await service.requestDeletion('user-1', 'wrong')).status, 'invalid_password');
  assert.equal((await service.requestDeletion('user-1', 'missing')).status, 'not_found');
  assert.deepEqual(await service.requestDeletion('user-1', 'again'), {
    status: 'already_requested',
    deletionScheduledFor: 88
  });
  assert.deepEqual(await service.requestDeletion('user-1', 'right-password'), {
    status: 'scheduled',
    deletionScheduledFor: 99
  });
  assert.deepEqual(calls.ended, [{ userId: 'user-1' }]);
  assert.deepEqual(calls.broadcast, ['user-1']);
  const vanished = harness({
    async getUserById() {
      return null;
    }
  });
  await vanished.service.requestDeletion('user-1', 'right-password');
  assert.deepEqual(vanished.calls.broadcast, []);

  assert.equal((await service.restore({ login: '', password: 'p', device })).status, 'invalid_credentials');
  assert.equal((await service.restore({ login: 'x', password: 'p', device })).status, 'invalid_credentials');
  assert.equal((await service.restore({ login: 'old', password: 'p', device })).status, 'expired');
  assert.equal((await service.restore({ login: 'ok', password: 'p', device })).status, 'signed_in');
});

// --- routes -----------------------------------------------------------------------

type Session = Awaited<ReturnType<ApiContext['resolveSession']>>;

function routeApp(
  t: TestContext,
  outcomes: Record<string, unknown> = {},
  {
    session = null,
    limited = [],
    deletionAvailable = true
  }: { session?: Session; limited?: string[]; deletionAvailable?: boolean } = {}
) {
  const app = fastify();
  registerHttpKit(app, { securityHeaders: () => ({}), recordRequest() {}, logRequest() {}, logHandlerFailure() {} });
  const seen: Record<string, unknown[]> = {};
  const me = { ...publicUser('user-1'), hasUsedDesktopApp: false, appPromptSeen: true };
  const opened = { status: 'signed_in', token: 'tok', user: me };
  const record =
    (name: string, value: unknown) =>
    async (...args: unknown[]) => {
      seen[name] = args;
      return outcomes[name] ?? value;
    };
  const account = fake<AccountService>({
    register: record('register', opened),
    login: record('login', opened),
    logout: record('logout', undefined),
    recover: record('recover', { ...opened, remaining: 2 }),
    restore: record('restore', opened),
    updateProfile: record('updateProfile', { status: 'updated', user: me }),
    changePassword: record('changePassword', { status: 'changed' }),
    security: record('security', {
      recoveryCodes: { remaining: 0, generatedAt: null },
      recoveryCodesReminder: { snoozedUntil: null }
    }),
    generateRecoveryCodes: record('generateRecoveryCodes', {
      status: 'generated',
      codes: ['c'],
      recoveryCodes: { remaining: 1, generatedAt: 1 }
    }),
    snoozeRecoveryCodesReminder: record('snoozeRecoveryCodesReminder', { status: 'snoozed', snoozedUntil: 3 }),
    listSessions: record('listSessions', []),
    revokeOtherSessions: record('revokeOtherSessions', 2),
    revokeSession: record('revokeSession', { status: 'revoked' }),
    whatsNew: record('whatsNew', { current: '1', lastSeen: null }),
    markWhatsNewSeen: record('markWhatsNewSeen', { status: 'seen', whatsNew: { current: '1', lastSeen: '1' } }),
    markAppPromptSeen: record('markAppPromptSeen', { status: 'seen' }),
    loginAlerts: record('loginAlerts', []),
    resolveLoginAlert: record('resolveLoginAlert', { status: 'resolved', resolution: 'confirmed' }),
    deletionPreview: record('deletionPreview', { status: 'preview', preview: { graceDays: 7, rooms: [] } }),
    requestDeletion: record('requestDeletion', { status: 'scheduled', deletionScheduledFor: 5 }),
    deletionAvailable: () => deletionAvailable
  } as Partial<Record<keyof AccountService, unknown>> as Partial<AccountService>);
  registerAccountRoutes(
    app,
    {
      logger: fake<ApiContext['logger']>(),
      clientIp: () => '203.0.113.1',
      resolveSession: async () => session,
      hashIp: (ip: string) => ip
    },
    {
      account,
      limiter: {
        check: (key) =>
          limited.some((prefix) => key.startsWith(prefix))
            ? { allowed: false, retryAfterSeconds: 11 }
            : { allowed: true }
      },
      sessionCookie: (token) => `vr_session=${token}`,
      clearedSessionCookie: () => 'vr_session=',
      sessionToken: () => 'raw-token',
      device: async () => DEVICE
    }
  );
  t.after(() => app.close());
  return { app, seen };
}

const SIGNED_IN = { user: storedUser(), session: { publicId: 'pub-1', tokenHash: 'hash-1' } };

type Body = { ok?: boolean; error?: string; user?: { id: string } } & Record<string, unknown>;

async function call(app: FastifyInstance, method: string, url: string, payload?: object) {
  const response = await app.inject({
    method: method as 'GET' | 'POST' | 'DELETE',
    url,
    ...(payload === undefined ? {} : { payload })
  });
  return {
    status: response.statusCode,
    body: response.json<Body>(),
    cookie: response.headers['set-cookie'],
    retryAfter: response.headers['retry-after']
  };
}

test('entry routes set the cookie and map every refusal', async (t) => {
  const { app, seen } = routeApp(t);
  const registered = await call(app, 'POST', '/api/auth/register', {
    login: ' Alice ',
    displayName: ' A ',
    password: 'pw'
  });
  assert.deepEqual([registered.status, registered.cookie, registered.body.user?.id], [201, 'vr_session=tok', 'user-1']);
  const registration = seen.register?.[0] as { login: string; passwordConfirm: string; device: () => Promise<unknown> };
  assert.equal(registration.login, 'alice');
  assert.equal(registration.passwordConfirm, 'pw');
  assert.deepEqual(await registration.device(), DEVICE);
  assert.equal((await call(app, 'POST', '/api/auth/login', { login: 'a', password: 'p' })).cookie, 'vr_session=tok');
  assert.equal((seen.login?.[0] as { password: string }).password, 'p');
  const out = await call(app, 'POST', '/api/auth/logout');
  assert.deepEqual([out.body, out.cookie], [{ ok: true }, 'vr_session=']);
  assert.deepEqual(seen.logout, ['raw-token']);
  const recovered = await call(app, 'POST', '/api/auth/recover', { login: 'alice', code: 'c', newPassword: 'n' });
  assert.deepEqual(recovered.body.recoveryCodes, { remaining: 2 });
  assert.equal(
    (await call(app, 'POST', '/api/auth/account/restore', { login: 'a', password: 'p' })).cookie,
    'vr_session=tok'
  );

  const cases: Array<[string, { status: string; retryAfterSeconds?: number }, string, number, string]> = [
    ['register', { status: 'invalid_login' }, '/api/auth/register', 400, 'Логин: 3–32 символа, латиница, цифры, . _ -'],
    ['register', { status: 'invalid_password' }, '/api/auth/register', 400, 'Пароль должен быть не короче 8 символов'],
    ['register', { status: 'password_mismatch' }, '/api/auth/register', 400, 'Пароли не совпадают'],
    ['register', { status: 'login_taken' }, '/api/auth/register', 409, 'Этот логин уже занят'],
    ['login', { status: 'invalid_credentials' }, '/api/auth/login', 401, 'Неверный логин или пароль'],
    [
      'login',
      { status: 'throttled', retryAfterSeconds: 4 },
      '/api/auth/login',
      429,
      'Слишком много попыток, попробуйте позже'
    ],
    [
      'recover',
      { status: 'invalid_new_password' },
      '/api/auth/recover',
      400,
      'Пароль должен быть не короче 8 символов'
    ],
    ['recover', { status: 'invalid_code' }, '/api/auth/recover', 401, 'Неверный логин или код восстановления'],
    ['restore', { status: 'expired' }, '/api/auth/account/restore', 410, 'Аккаунт уже удалён'],
    ['restore', { status: 'invalid_credentials' }, '/api/auth/account/restore', 401, 'Неверный логин или пароль']
  ];
  for (const [name, outcome, url, status, error] of cases) {
    const response = await call(routeApp(t, { [name]: outcome }).app, 'POST', url, {});
    assert.deepEqual([response.status, response.body.error], [status, error], `${name} ${outcome.status}`);
  }
  const pending = await call(
    routeApp(t, { login: { status: 'deletion_pending', deletionScheduledFor: 77 } }).app,
    'POST',
    '/api/auth/login',
    {}
  );
  assert.deepEqual(pending.body, {
    ok: false,
    error: 'Аккаунт ожидает удаления',
    code: 'account_deletion_pending',
    deletionScheduledFor: 77
  });
});

test('entry routes are rate limited per address and per login', async (t) => {
  for (const [prefix, url] of [
    ['register:', '/api/auth/register'],
    ['login:', '/api/auth/login'],
    ['recover:', '/api/auth/recover'],
    ['restore:', '/api/auth/account/restore']
  ] as const) {
    const response = await call(routeApp(t, {}, { limited: [prefix] }).app, 'POST', url, { login: 'alice' });
    assert.deepEqual([response.status, response.retryAfter], [429, '11'], url);
  }
  const perLogin = routeApp(t, {}, { limited: ['recover-login:'] });
  assert.equal((await call(perLogin.app, 'POST', '/api/auth/recover', { login: 'alice' })).status, 429);
  assert.equal((await call(perLogin.app, 'POST', '/api/auth/recover', {})).status, 200);
  const off = await call(routeApp(t, {}, { deletionAvailable: false }).app, 'POST', '/api/auth/account/restore', {});
  assert.deepEqual([off.status, off.body.error], [503, 'Удаление аккаунта сейчас недоступно']);
});

test('me answers null without a session', async (t) => {
  assert.deepEqual((await call(routeApp(t).app, 'GET', '/api/auth/me')).body, { ok: true, user: null });
  const me = await call(
    routeApp(t, {}, { session: { ...SIGNED_IN, user: storedUser({ id: 'user-1', login: 'alice' }) } }).app,
    'GET',
    '/api/auth/me'
  );
  assert.equal(me.body.user?.id, 'user-1');
});

const ACCOUNT_ROUTES: Array<[string, string, object?]> = [
  ['POST', '/api/auth/profile', {}],
  ['POST', '/api/auth/password', {}],
  ['GET', '/api/auth/security'],
  ['POST', '/api/auth/recovery-codes', {}],
  ['POST', '/api/auth/recovery-codes/reminder/snooze'],
  ['GET', '/api/auth/sessions'],
  ['POST', '/api/auth/sessions/revoke-others'],
  ['DELETE', '/api/auth/sessions/pub-2'],
  ['GET', '/api/auth/whats-new'],
  ['POST', '/api/auth/whats-new/seen'],
  ['POST', '/api/auth/app-prompt/seen'],
  ['GET', '/api/auth/login-alerts'],
  ['POST', '/api/auth/login-alerts/a1/confirm'],
  ['POST', '/api/auth/login-alerts/a1/deny'],
  ['GET', '/api/auth/account/deletion'],
  ['POST', '/api/auth/account/deletion', {}]
];

test('every account route needs a session and answers it', async (t) => {
  const anonymous = routeApp(t).app;
  const signedIn = routeApp(t, {}, { session: SIGNED_IN });
  for (const [method, url, payload] of ACCOUNT_ROUTES) {
    const refused = await call(anonymous, method, url, payload);
    assert.deepEqual(
      [refused.status, refused.body],
      [401, { ok: false, error: 'Требуется вход', code: 'authentication_required' }],
      url
    );
    const answered = await call(signedIn.app, method, url, payload);
    assert.equal(answered.status, 200, url);
    assert.equal(answered.body.ok, true, url);
  }
  assert.deepEqual(signedIn.seen.revokeSession, ['user-1', 'pub-1', 'pub-2']);
  assert.deepEqual(signedIn.seen.resolveLoginAlert, ['user-1', 'pub-1', 'a1', 'denied']);
  assert.deepEqual(signedIn.seen.listSessions, ['user-1', 'hash-1']);
  const password = await call(signedIn.app, 'POST', '/api/auth/password', { currentPassword: 'a', newPassword: 'b' });
  assert.equal(password.cookie, 'vr_session=');
  assert.deepEqual(signedIn.seen.changePassword, ['user-1', 'a', 'b']);
  const deletion = await call(signedIn.app, 'POST', '/api/auth/account/deletion', { currentPassword: 'p' });
  assert.deepEqual([deletion.body, deletion.cookie], [{ ok: true, deletionScheduledFor: 5 }, 'vr_session=']);
  assert.deepEqual((await call(signedIn.app, 'GET', '/api/auth/account/deletion')).body, {
    ok: true,
    graceDays: 7,
    rooms: []
  });
  assert.deepEqual((await call(signedIn.app, 'POST', '/api/auth/login-alerts/a1/confirm')).body, {
    ok: true,
    resolution: 'confirmed'
  });
});

test('account refusals keep their texts', async (t) => {
  const cases: Array<[string, { status: string }, string, string, number, string]> = [
    ['updateProfile', { status: 'not_found' }, 'POST', '/api/auth/profile', 404, 'Аккаунт не найден'],
    [
      'changePassword',
      { status: 'invalid_new_password' },
      'POST',
      '/api/auth/password',
      400,
      'Пароль должен быть не короче 8 символов'
    ],
    ['changePassword', { status: 'not_found' }, 'POST', '/api/auth/password', 404, 'Аккаунт не найден'],
    ['changePassword', { status: 'invalid_password' }, 'POST', '/api/auth/password', 400, 'Неверный текущий пароль'],
    ['generateRecoveryCodes', { status: 'not_found' }, 'POST', '/api/auth/recovery-codes', 404, 'Аккаунт не найден'],
    [
      'generateRecoveryCodes',
      { status: 'invalid_password' },
      'POST',
      '/api/auth/recovery-codes',
      400,
      'Неверный пароль'
    ],
    [
      'snoozeRecoveryCodesReminder',
      { status: 'not_found' },
      'POST',
      '/api/auth/recovery-codes/reminder/snooze',
      404,
      'Аккаунт не найден'
    ],
    [
      'revokeSession',
      { status: 'current_session' },
      'DELETE',
      '/api/auth/sessions/pub-1',
      400,
      'Чтобы завершить этот сеанс, выйдите из аккаунта'
    ],
    ['revokeSession', { status: 'not_found' }, 'DELETE', '/api/auth/sessions/x', 404, 'Сеанс не найден'],
    ['markWhatsNewSeen', { status: 'not_found' }, 'POST', '/api/auth/whats-new/seen', 404, 'Аккаунт не найден'],
    ['markAppPromptSeen', { status: 'not_found' }, 'POST', '/api/auth/app-prompt/seen', 404, 'Аккаунт не найден'],
    [
      'resolveLoginAlert',
      { status: 'not_found' },
      'POST',
      '/api/auth/login-alerts/x/deny',
      404,
      'Вход не найден или на него уже ответили'
    ],
    [
      'deletionPreview',
      { status: 'unavailable' },
      'GET',
      '/api/auth/account/deletion',
      503,
      'Удаление аккаунта сейчас недоступно'
    ],
    [
      'requestDeletion',
      { status: 'unavailable' },
      'POST',
      '/api/auth/account/deletion',
      503,
      'Удаление аккаунта сейчас недоступно'
    ],
    ['requestDeletion', { status: 'invalid_password' }, 'POST', '/api/auth/account/deletion', 400, 'Неверный пароль'],
    ['requestDeletion', { status: 'not_found' }, 'POST', '/api/auth/account/deletion', 404, 'Аккаунт не найден']
  ];
  for (const [name, outcome, method, url, status, error] of cases) {
    const response = await call(
      routeApp(t, { [name]: outcome }, { session: SIGNED_IN }).app,
      method,
      url,
      method === 'POST' ? {} : undefined
    );
    assert.deepEqual([response.status, response.body.error], [status, error], `${name} ${outcome.status}`);
  }
  const again = await call(
    routeApp(t, { requestDeletion: { status: 'already_requested', deletionScheduledFor: 8 } }, { session: SIGNED_IN })
      .app,
    'POST',
    '/api/auth/account/deletion',
    {}
  );
  assert.deepEqual(again.body, {
    ok: false,
    error: 'Аккаунт уже ожидает удаления',
    code: 'account_deletion_pending',
    deletionScheduledFor: 8
  });
  const off = await call(
    routeApp(t, {}, { session: SIGNED_IN, deletionAvailable: false }).app,
    'POST',
    '/api/auth/account/deletion',
    {}
  );
  assert.equal(off.status, 503);
  for (const [prefix, url] of [
    ['password:', '/api/auth/password'],
    ['recovery-codes:', '/api/auth/recovery-codes'],
    ['account-deletion:', '/api/auth/account/deletion']
  ] as const) {
    const response = await call(routeApp(t, {}, { session: SIGNED_IN, limited: [prefix] }).app, 'POST', url, {});
    assert.equal(response.status, 429, url);
  }
});
