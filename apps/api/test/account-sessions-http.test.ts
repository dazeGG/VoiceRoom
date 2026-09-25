import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Me,
  Recovered,
  RecoveryCodesGenerated,
  ReminderSnoozed,
  Security,
  Sessions,
  SessionsRevoked,
  WhatsNewAnswer
} from '@voice-room/shared/contracts/account';
import { cookieFrom, request, startApiServer } from './fakes/server-process.ts';
import { openWs, waitForClose } from './ws-harness.ts';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';
const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0';
const FORMATTED_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const SESSION_ENDED_CLOSE_CODE = 4401;

async function startServer(t: TestContext, env: Record<string, string> = {}) {
  const { socketPath } = await startApiServer(t, {
    prefix: 'voice-room-account-',
    env: { AUTH_RATE_LIMIT: '0', ...env }
  });
  return socketPath;
}

async function signIn(
  socketPath: string,
  { register = false, login = 'ada', password = 'password123', userAgent = CHROME_WINDOWS } = {}
) {
  const response = await request(socketPath, {
    method: 'POST',
    pathname: register ? '/api/auth/register' : '/api/auth/login',
    headers: { 'User-Agent': userAgent },
    body: register ? { login, password, passwordConfirm: password } : { login, password }
  });
  assert.equal(response.status, register ? 201 : 200);
  return cookieFrom(response.setCookie);
}

async function me(socketPath: string, cookie: string) {
  const response = await request<Me>(socketPath, { pathname: '/api/auth/me', cookie });
  assert.equal(response.status, 200);
  return response.body.user;
}

test('signed-in devices are listed without secrets and an ended session loses its socket at once', async (t) => {
  const socketPath = await startServer(t);
  const laptop = await signIn(socketPath, { register: true, userAgent: CHROME_WINDOWS });
  const desktop = await signIn(socketPath, { userAgent: FIREFOX_LINUX });

  assert.equal((await request(socketPath, { pathname: '/api/auth/sessions' })).status, 401);

  const listed = await request<Sessions>(socketPath, { pathname: '/api/auth/sessions', cookie: laptop });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.sessions.length, 2);
  for (const session of listed.body.sessions) {
    assert.deepEqual(Object.keys(session).sort(), ['client', 'current', 'id', 'lastSeenAt', 'location', 'os']);
  }
  const current = listed.body.sessions.find((session) => session.current);
  const other = listed.body.sessions.find((session) => !session.current);
  assert.ok(current && other);
  assert.deepEqual([current.client, current.os], ['Chrome', 'Windows']);
  assert.deepEqual([other.client, other.os], ['Firefox', 'Linux']);
  assert.equal(other.location, '', 'no GeoIP database is configured in tests');

  const ownSession = await request(socketPath, {
    method: 'DELETE',
    pathname: `/api/auth/sessions/${current.id}`,
    cookie: laptop
  });
  assert.equal(ownSession.status, 400);

  const socket = openWs(socketPath, { cookie: desktop });
  await socket.ready;
  const closed = waitForClose(socket.ws);

  const ended = await request(socketPath, {
    method: 'DELETE',
    pathname: `/api/auth/sessions/${other.id}`,
    cookie: laptop
  });
  assert.equal(ended.status, 200);
  assert.equal(await closed, SESSION_ENDED_CLOSE_CODE);
  assert.equal(await me(socketPath, desktop), null);
  assert.equal((await me(socketPath, laptop))?.login, 'ada');

  const again = await request(socketPath, {
    method: 'DELETE',
    pathname: `/api/auth/sessions/${other.id}`,
    cookie: laptop
  });
  assert.equal(again.status, 404);
  const garbage = await request(socketPath, {
    method: 'DELETE',
    pathname: '/api/auth/sessions/not-a-session',
    cookie: laptop
  });
  assert.equal(garbage.status, 404);

  const phone = await signIn(socketPath, { userAgent: FIREFOX_LINUX });
  const revoked = await request<SessionsRevoked>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/sessions/revoke-others',
    cookie: laptop,
    body: {}
  });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.revoked, 1);
  assert.equal(await me(socketPath, phone), null);
  assert.equal((await me(socketPath, laptop))?.login, 'ada');
});

test('recovery codes restore access over HTTP and end every earlier session', async (t) => {
  const socketPath = await startServer(t);
  const cookie = await signIn(socketPath, { register: true });

  const initial = await request<Security>(socketPath, { pathname: '/api/auth/security', cookie });
  assert.equal(initial.status, 200);
  assert.deepEqual(initial.body.recoveryCodes, { remaining: 0, generatedAt: null });
  assert.deepEqual(initial.body.recoveryCodesReminder, { snoozedUntil: null });

  // A freshly registered account starts at the current announcement.
  const whatsNew = await request<WhatsNewAnswer>(socketPath, { pathname: '/api/auth/whats-new', cookie });
  assert.equal(whatsNew.status, 200);
  assert.match(whatsNew.body.whatsNew.current, /^\d+\.\d+\.\d+$/);
  assert.equal(whatsNew.body.whatsNew.lastSeen, whatsNew.body.whatsNew.current);
  assert.equal((await request(socketPath, { pathname: '/api/auth/whats-new' })).status, 401);

  const wrongPassword = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/recovery-codes',
    cookie,
    body: { currentPassword: 'not-the-password' }
  });
  assert.equal(wrongPassword.status, 400);

  const generated = await request<RecoveryCodesGenerated>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/recovery-codes',
    cookie,
    body: { currentPassword: 'password123' }
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.headers['cache-control'], 'no-store');
  assert.equal(generated.body.codes.length, 10);
  for (const code of generated.body.codes) assert.match(code, FORMATTED_CODE);
  assert.equal(
    (await request<Security>(socketPath, { pathname: '/api/auth/security', cookie })).body.recoveryCodes.remaining,
    10
  );

  const snoozed = await request<ReminderSnoozed>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/recovery-codes/reminder/snooze',
    cookie,
    body: {}
  });
  assert.equal(snoozed.status, 200);
  assert.ok((snoozed.body.recoveryCodesReminder.snoozedUntil ?? 0) > Date.now() + 2 * 24 * 60 * 60 * 1000);
  assert.deepEqual(
    (await request<Security>(socketPath, { pathname: '/api/auth/security', cookie })).body.recoveryCodesReminder,
    snoozed.body.recoveryCodesReminder
  );

  const seen = await request<WhatsNewAnswer>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/whats-new/seen',
    cookie,
    body: {}
  });
  assert.equal(seen.status, 200);
  assert.equal(seen.body.whatsNew.lastSeen, seen.body.whatsNew.current);

  const socket = openWs(socketPath, { cookie });
  await socket.ready;
  const closed = waitForClose(socket.ws);

  const wrongCode = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/recover',
    body: { login: 'ada', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', newPassword: 'brand-new-password' }
  });
  assert.equal(wrongCode.status, 401);
  assert.equal(wrongCode.setCookie.length, 0);

  const [code] = generated.body.codes;
  assert.ok(code);
  const shortPassword = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/recover',
    body: { login: 'ada', code, newPassword: 'short' }
  });
  assert.equal(shortPassword.status, 400, 'a rejected password must not spend the code');

  const recovered = await request<Recovered>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/recover',
    headers: { 'User-Agent': FIREFOX_LINUX },
    body: { login: 'ADA', code: code.toLowerCase(), newPassword: 'brand-new-password' }
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.user.login, 'ada');
  assert.equal('passwordHash' in recovered.body.user, false);
  assert.equal(recovered.body.recoveryCodes.remaining, 9);
  const recoveredCookie = cookieFrom(recovered.setCookie);
  assert.match(recoveredCookie, /^vr_session=/);

  assert.equal(await closed, SESSION_ENDED_CLOSE_CODE);
  assert.equal(await me(socketPath, cookie), null);
  assert.equal((await me(socketPath, recoveredCookie))?.login, 'ada');

  const reused = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/recover',
    body: { login: 'ada', code, newPassword: 'another-password' }
  });
  assert.equal(reused.status, 401);

  const oldPassword = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: { login: 'ada', password: 'password123' }
  });
  assert.equal(oldPassword.status, 401);
  await signIn(socketPath, { password: 'brand-new-password' });
});

test('recovery attempts are rate limited per address', async (t) => {
  const socketPath = await startServer(t, { AUTH_RATE_LIMIT: '2', AUTH_RATE_WINDOW_MS: '60000' });
  const attempt = () =>
    request(socketPath, {
      method: 'POST',
      pathname: '/api/auth/recover',
      body: { login: 'nobody', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', newPassword: 'brand-new-password' }
    });

  assert.equal((await attempt()).status, 401);
  const limited = await (async () => {
    for (let index = 0; index < 3; index += 1) {
      const response = await attempt();
      if (response.status === 429) return response;
    }
    return null;
  })();
  assert.ok(limited, 'repeated recovery attempts must be throttled');
  assert.ok(Number(limited.headers['retry-after']) > 0);
});
