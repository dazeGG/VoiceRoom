// Getting into the admin app and what each staff role may do there. The main
// site hands a signed-in staff session over for a one-time code; the code
// becomes the admin app's own cookie; anyone else ends on a 404. A moderator
// reviews reports and rooms and blocks for a while, but sees no numbers, no
// address keys and no block for good; only a superadmin gives roles. Signing
// out on the main site ends the admin session with it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Value } from 'typebox/value';
import { RoomHistory } from '@voice-room/shared/contracts/admin';
import { StaffList, StaffMe } from '@voice-room/shared/contracts/staff';
import { hashPassword } from '../src/lib/password.ts';
import { cookieFrom, registerAccount, request, startApiServer } from './fakes/server-process.ts';
import { staffCookie } from './staff-session.ts';

const skip = !process.env.TEST_DATABASE_URL;
const ROOT_ID = '00000000-0000-4000-8000-0000000000ad';
const ADMIN_ORIGIN = 'https://admin.example.test';
const SITE_ORIGIN = 'https://example.test';
/** What a browser on the admin app sends with a write. */
const FROM_ADMIN_APP = { Origin: ADMIN_ORIGIN, Host: new URL(ADMIN_ORIGIN).host };
const STATE = '11111111-2222-4333-8444-555555555555';
const OTHER_STATE = '66666666-7777-4888-9999-aaaaaaaaaaaa';

/** A handed-over code for the account behind `cookie`, with the state its check gave. */
async function handOver(socketPath: string, cookie: string, state: string): Promise<string> {
  const handed = await request(socketPath, { pathname: `/api/staff/handoff?state=${state}`, cookie });
  return new URL(handed.headers.location ?? '').searchParams.get('code') ?? '';
}

function callback(socketPath: string, code: string, state: string, cookie: string) {
  return request(socketPath, {
    pathname: `/api/staff/callback?${new URLSearchParams({ code, state }).toString()}`,
    cookie
  });
}

async function userId(socketPath: string, cookie: string): Promise<string> {
  const { body } = await request(socketPath, { pathname: '/api/auth/me', cookie });
  const user = body.user;
  if (typeof user !== 'object' || user === null || !('id' in user) || typeof user.id !== 'string') {
    throw new Error('no signed-in user');
  }
  return user.id;
}

test('the admin app takes a staff session only through a one-time handoff', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-staff-handoff-',
    env: { AUTH_RATE_LIMIT: '0', PLATFORM_ADMIN_USER_IDS: ROOT_ID, SITE_ORIGIN, ADMIN_ORIGIN }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ROOT_ID,
    await hashPassword('password123')
  ]);
  const rootSite = cookieFrom(
    (
      await request(socketPath, {
        method: 'POST',
        pathname: '/api/auth/login',
        body: { login: 'root', password: 'password123' }
      })
    ).setCookie
  );
  const alice = await registerAccount(socketPath, 'alice');

  // Not staff, or signed out: the handoff turns the browser away to the 404.
  for (const cookie of [alice, '']) {
    const refused = await request(socketPath, { pathname: '/api/staff/handoff?state=s', cookie });
    assert.equal(refused.status, 302);
    assert.equal(refused.headers.location, `${ADMIN_ORIGIN}/api/staff/denied`);
  }
  assert.equal(await staffCookie(socketPath, alice), '');
  assert.equal((await request(socketPath, { pathname: '/api/staff/denied' })).status, 404);

  // Staff: a code for the admin app, traded once, and only with the state the app set.
  const handed = await request(socketPath, { pathname: `/api/staff/handoff?state=${STATE}`, cookie: rootSite });
  const back = new URL(handed.headers.location ?? '');
  assert.equal(back.origin, ADMIN_ORIGIN);
  assert.equal(back.searchParams.get('state'), STATE);
  const code = back.searchParams.get('code') ?? '';
  const wrongState = await callback(socketPath, code, STATE, `vr_staff_state_${OTHER_STATE}=%2F`);
  assert.equal(wrongState.headers.location, '/api/staff/denied', 'a callback without the matching state is refused');
  const traded = await callback(socketPath, code, STATE, `vr_staff_state_${STATE}=%2Freports`);
  assert.equal(traded.headers.location, '/reports', 'back to the page the visit began on');
  // Lax: a link from a messenger or a mail still arrives signed in.
  assert.ok(traded.setCookie.some((line) => line.startsWith('vr_staff=') && line.includes('SameSite=Lax')));
  const reused = await callback(socketPath, code, STATE, `vr_staff_state_${STATE}=%2Freports`);
  assert.equal(reused.headers.location, '/api/staff/denied', 'a code is traded once');

  // Two admin tabs reopened together each keep their own state and both come back signed in.
  const both = `vr_staff_state_${STATE}=%2Frooms; vr_staff_state_${OTHER_STATE}=%2Freports`;
  const firstTab = await callback(socketPath, await handOver(socketPath, rootSite, STATE), STATE, both);
  const secondTab = await callback(socketPath, await handOver(socketPath, rootSite, OTHER_STATE), OTHER_STATE, both);
  assert.deepEqual([firstTab.headers.location, secondTab.headers.location], ['/rooms', '/reports']);

  const admin = await staffCookie(socketPath, rootSite);
  assert.match(admin, /^vr_staff=/);
  const me = (await request(socketPath, { pathname: '/api/staff/me', cookie: admin })).body;
  if (!Value.Check(StaffMe, me)) throw new Error('no staff answer');
  assert.equal(me.role, 'superadmin', 'an account named in the settings is a superadmin');
  assert.equal(me.siteUrl, SITE_ORIGIN);

  // Caddy's gate: the session passes, a page load without one goes to the main site, anything else is a 404.
  assert.equal((await request(socketPath, { pathname: '/api/staff/check', cookie: admin })).status, 204);
  const visit = await request(socketPath, {
    pathname: '/api/staff/check',
    headers: { 'Sec-Fetch-Mode': 'navigate', 'X-Forwarded-Uri': '/rooms' }
  });
  assert.equal(visit.status, 302);
  assert.ok(visit.headers.location?.startsWith(`${SITE_ORIGIN}/api/staff/handoff?state=`));
  assert.ok(visit.setCookie.some((line) => line.startsWith('vr_staff_state_') && line.includes('=%2Frooms;')));
  assert.equal((await request(socketPath, { pathname: '/api/staff/check' })).status, 404);
  // A browser without Fetch Metadata is sent through the handoff on a page load too.
  const oldBrowser = await request(socketPath, { pathname: '/api/staff/check', headers: { Accept: 'text/html' } });
  assert.equal(oldBrowser.status, 302);
  // A browser reads "/\host" as "//host": such a visit comes back to the start instead.
  for (const uri of ['/\\evil.test', '/rooms\\x', '/a\tb']) {
    const odd = await request(socketPath, {
      pathname: '/api/staff/check',
      headers: { 'Sec-Fetch-Mode': 'navigate', 'X-Forwarded-Uri': uri }
    });
    assert.ok(
      odd.setCookie.some((line) => line.startsWith('vr_staff_state_') && line.includes('=%2F;')),
      JSON.stringify(uri)
    );
  }

  // The main-site session alone opens nothing in the admin API; the admin cookie does. Without
  // one the admin app is told to go through the handoff again.
  for (const cookie of [rootSite, '', 'vr_staff=gone']) {
    const refused = await request(socketPath, { pathname: '/api/admin/overview', cookie });
    assert.equal(refused.status, 401);
    assert.equal(refused.body.code, 'staff_session_required');
  }
  assert.equal((await request(socketPath, { pathname: '/api/admin/overview', cookie: admin })).status, 200);

  // A write from another origin with the admin cookie is refused.
  const crossOrigin = await request(socketPath, {
    method: 'POST',
    pathname: '/api/staff/logout',
    cookie: admin,
    headers: { Origin: SITE_ORIGIN, Host: new URL(ADMIN_ORIGIN).host }
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.body.code, 'cross_origin_rejected');

  // Signing out of the main site ends the admin session that was handed over from it, and a
  // code handed over just before is worth nothing.
  const late = await handOver(socketPath, rootSite, STATE);
  await request(socketPath, { method: 'POST', pathname: '/api/auth/logout', cookie: rootSite });
  assert.equal((await request(socketPath, { pathname: '/api/staff/me', cookie: admin })).status, 401);
  const lateTrade = await callback(socketPath, late, STATE, `vr_staff_state_${STATE}=%2F`);
  assert.equal(lateTrade.status, 302);
  assert.equal(lateTrade.headers.location, '/api/staff/denied');
});

test('a moderator reviews and blocks for a while; numbers, address keys and roles take more', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-staff-roles-',
    env: {
      AUTH_RATE_LIMIT: '0',
      PLATFORM_ADMIN_USER_IDS: ROOT_ID,
      SITE_ORIGIN,
      ADMIN_ORIGIN,
      ROOM_PRUNE_INTERVAL_MS: '200'
    }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ROOT_ID,
    await hashPassword('password123')
  ]);
  const root = await staffCookie(
    socketPath,
    cookieFrom(
      (
        await request(socketPath, {
          method: 'POST',
          pathname: '/api/auth/login',
          body: { login: 'root', password: 'password123' }
        })
      ).setCookie
    )
  );
  const moderatorSite = await registerAccount(socketPath, 'mod');
  const bob = await registerAccount(socketPath, 'bob');
  const bobId = await userId(socketPath, bob);
  const putRole = (cookie: string, login: string, role: string | null) =>
    request(socketPath, {
      method: 'PUT',
      pathname: '/api/staff/role',
      cookie,
      headers: FROM_ADMIN_APP,
      body: { login, role }
    });

  assert.equal((await putRole(root, 'mod', 'moderator')).status, 200);
  assert.equal((await putRole(root, 'root', 'moderator')).status, 409, 'nobody changes their own role');
  assert.equal((await putRole(root, 'nobody-here', 'admin')).status, 404);
  // A blocked staff member's role can still be taken away.
  assert.equal((await putRole(root, 'bob', 'moderator')).status, 200);
  await pool.query(`UPDATE users SET blocked_at = now(), blocked_until = NULL WHERE id = $1`, [bobId]);
  assert.equal((await putRole(root, 'bob', null)).status, 200);
  await pool.query(`UPDATE users SET blocked_at = NULL WHERE id = $1`, [bobId]);
  const members = (await request(socketPath, { pathname: '/api/staff/members', cookie: root })).body;
  if (!Value.Check(StaffList, members)) throw new Error('no staff list');
  assert.deepEqual(
    members.staff.map((member) => [member.user.login, member.role, member.fixed]),
    [
      ['mod', 'moderator', false],
      ['root', 'superadmin', true]
    ]
  );
  const logged = await pool.query<{ role: string | null }>(
    `SELECT details->>'role' AS role FROM admin_actions WHERE action = 'staff_role'`
  );
  assert.deepEqual(logged.rows.map((row) => String(row.role)).sort(), ['moderator', 'moderator', 'null']);

  const moderator = await staffCookie(socketPath, moderatorSite);
  assert.notEqual(moderator, '');
  const get = (pathname: string) => request(socketPath, { pathname, cookie: moderator });
  assert.equal((await get('/api/admin/reports')).status, 200);
  assert.equal((await get('/api/admin/accounts')).status, 200);
  assert.equal((await get('/api/admin/rooms')).status, 200);
  for (const pathname of ['/api/admin/overview', '/api/admin/product', '/api/admin/system', '/api/admin/feedback']) {
    assert.equal((await get(pathname)).status, 403, pathname);
  }
  assert.equal((await get('/api/staff/members')).status, 403);
  assert.equal((await putRole(moderator, 'bob', 'admin')).status, 403, 'only a superadmin gives roles');

  // The history shows a moderator who and when, never where from.
  await pool.query(`INSERT INTO rooms (id, creator_ip, is_static, name) VALUES ('porch', '', false, 'Крыльцо')`);
  await pool.query(
    `INSERT INTO voice_sessions (room_id, user_id, guest_name, ip_key, location, joined_at, left_at)
     VALUES ('porch', NULL, 'Петя', '0123456789abcdef', 'Казань, Россия', now() - interval '2 hours', now() - interval '1 hour')`
  );
  const history = async (cookie: string) => {
    const { body } = await request(socketPath, { pathname: '/api/admin/rooms/history', cookie });
    if (!Value.Check(RoomHistory, body)) throw new Error('no history');
    return body.stays.map((stay) => [stay.guestName, stay.ipKey, stay.location]);
  };
  assert.deepEqual(await history(moderator), [['Петя', null, null]]);
  assert.deepEqual(await history(root), [['Петя', '0123456789abcdef', 'Казань, Россия']]);

  // A moderator blocks for a while, not for good, and never a staff member.
  const block = (cookie: string, target: string, duration: string) =>
    request(socketPath, {
      method: 'POST',
      pathname: `/api/admin/accounts/${target}/block`,
      cookie,
      headers: FROM_ADMIN_APP,
      body: { duration, reason: 'спам' }
    });
  assert.equal((await block(moderator, bobId, 'forever')).status, 403);
  assert.equal((await block(moderator, bobId, 'day')).status, 200);
  assert.equal((await block(moderator, ROOT_ID, 'day')).status, 403, 'staff accounts are not blocked from the panel');

  // Taking the role away ends what the session may do at once.
  assert.equal((await putRole(root, 'mod', null)).status, 200);
  assert.equal((await get('/api/admin/reports')).status, 401);

  // Expired admin-app sessions are swept away.
  await pool.query(`UPDATE staff_sessions SET expires_at = now() - interval '1 minute'`);
  const started = Date.now();
  let left = 1;
  while (left > 0 && Date.now() - started < 10000) {
    left = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM staff_sessions`)).rows[0]?.n ?? 0;
    if (left > 0) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(left, 0);
});

test('over HTTPS the admin cookies are kept to the admin host (__Host-)', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-staff-secure-',
    env: {
      AUTH_RATE_LIMIT: '0',
      PLATFORM_ADMIN_USER_IDS: ROOT_ID,
      SITE_ORIGIN,
      ADMIN_ORIGIN,
      SESSION_COOKIE_SECURE: 'true'
    }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ROOT_ID,
    await hashPassword('password123')
  ]);
  const rootSite = cookieFrom(
    (
      await request(socketPath, {
        method: 'POST',
        pathname: '/api/auth/login',
        body: { login: 'root', password: 'password123' }
      })
    ).setCookie
  );

  const visit = await request(socketPath, { pathname: '/api/staff/check', headers: { 'Sec-Fetch-Mode': 'navigate' } });
  assert.ok(visit.setCookie.some((line) => line.startsWith('__Host-vr_staff_state_') && line.includes('Secure')));

  const traded = await callback(
    socketPath,
    await handOver(socketPath, rootSite, STATE),
    STATE,
    `__Host-vr_staff_state_${STATE}=%2F`
  );
  const line = traded.setCookie.find((value) => value.startsWith('__Host-vr_staff=')) ?? '';
  assert.ok(line.includes('Secure') && line.includes('Path=/') && !/Domain=/i.test(line), line);
  const token = line.split(';')[0]?.split('=')[1] ?? '';
  assert.equal(
    (await request(socketPath, { pathname: '/api/staff/me', cookie: `__Host-vr_staff=${token}` })).status,
    200
  );
  // The same token under the bare name, as a sibling subdomain could set it, is not taken.
  assert.equal((await request(socketPath, { pathname: '/api/staff/me', cookie: `vr_staff=${token}` })).status, 401);
});

test('the desktop app opens the admin app in the system browser with a one-time link', { skip }, async (t) => {
  const { socketPath, databaseUrl, beforeCleanup } = await startApiServer(t, {
    prefix: 'voice-room-staff-browser-',
    env: { AUTH_RATE_LIMIT: '0', PLATFORM_ADMIN_USER_IDS: ROOT_ID, SITE_ORIGIN, ADMIN_ORIGIN }
  });
  const pool = new Pool({ connectionString: databaseUrl });
  beforeCleanup(() => pool.end());
  await pool.query(`INSERT INTO users (id, login, display_name, password_hash) VALUES ($1, 'root', 'Root', $2)`, [
    ROOT_ID,
    await hashPassword('password123')
  ]);
  const rootSite = cookieFrom(
    (
      await request(socketPath, {
        method: 'POST',
        pathname: '/api/auth/login',
        body: { login: 'root', password: 'password123' }
      })
    ).setCookie
  );
  const alice = await registerAccount(socketPath, 'alice');
  const BrowserEntry = Type.Object({
    ok: Type.Literal(true),
    url: Type.Union([Type.String(), Type.Null()])
  });

  assert.equal((await request(socketPath, { pathname: '/api/staff/browser-entry?next=/reports' })).status, 401);
  const stranger = await request(
    socketPath,
    { pathname: '/api/staff/browser-entry?next=/reports', cookie: alice },
    BrowserEntry
  );
  assert.equal(stranger.body.url, null, 'someone who is not staff gets no link');

  // A code from the in-browser redirect is refused without its state cookie and still works afterwards.
  const redirectCode = await handOver(socketPath, rootSite, STATE);
  const bare = await request(socketPath, { pathname: `/api/staff/callback?code=${encodeURIComponent(redirectCode)}` });
  assert.equal(bare.headers.location, '/api/staff/denied');
  const retried = await callback(socketPath, redirectCode, STATE, `vr_staff_state_${STATE}=%2Frooms`);
  assert.equal(retried.headers.location, '/rooms');

  const entry = await request(
    socketPath,
    { pathname: '/api/staff/browser-entry?next=/reports', cookie: rootSite },
    BrowserEntry
  );
  const link = new URL(entry.body.url ?? '');
  assert.equal(link.origin, ADMIN_ORIGIN);
  assert.equal(link.pathname, '/api/staff/callback');
  assert.equal(link.searchParams.has('state'), false);
  const code = link.searchParams.get('code') ?? '';
  const traded = await request(socketPath, { pathname: `/api/staff/callback?code=${encodeURIComponent(code)}` });
  assert.equal(traded.headers.location, '/reports');
  assert.ok(traded.setCookie.some((line) => line.startsWith('vr_staff=') && line.includes('SameSite=Lax')));
  const reused = await request(socketPath, { pathname: `/api/staff/callback?code=${encodeURIComponent(code)}` });
  assert.equal(reused.headers.location, '/api/staff/denied', 'a browser link is traded once');

  const stray = await request(
    socketPath,
    { pathname: `/api/staff/browser-entry?next=${encodeURIComponent('https://evil.example/x')}`, cookie: rootSite },
    BrowserEntry
  );
  const strayCode = new URL(stray.body.url ?? '').searchParams.get('code') ?? '';
  const landed = await request(socketPath, {
    pathname: `/api/staff/callback?code=${encodeURIComponent(strayCode)}`
  });
  assert.equal(landed.headers.location, '/', 'a next path that leaves the admin app is dropped');
});
