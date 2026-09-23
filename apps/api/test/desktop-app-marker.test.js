import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';

import { runMigrations } from '../src/lib/migrate.js';
import {
  createUserStore,
  hashSessionToken,
  publicUser,
  selfUser
} from '../src/lib/user-store.js';
import { createTestDatabase } from './db-harness.js';
import { socketPathForDirectory } from './ipc-harness.js';

const SILENT = { log() {}, info() {}, warn() {}, error() {} };
const MIGRATION = '20260916150000_backfill_desktop_app_marker';
const MIGRATIONS_DIR = path.join(import.meta.dirname, '../src/migrations');
const DESKTOP_APP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) VoiceRoom/1.3.3 Chrome/138.0.0.0 Electron/37.2.0 Safari/537.36';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36';

function rollbackCountThrough(name) {
  const names = fs.readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.cjs'))
    .map((file) => file.replace(/\.c?js$/, ''))
    .sort();
  const index = names.indexOf(name);
  assert.notEqual(index, -1, `${name} is missing from the migrations directory`);
  return names.length - index;
}

async function metadataOf(pool, userId) {
  const result = await pool.query(`SELECT metadata, updated_at FROM users WHERE id = $1`, [userId]);
  return { metadata: result.rows[0].metadata, updatedAt: result.rows[0].updated_at.getTime() };
}

async function waitFor(check, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    if (await check()) return;
    if (Date.now() - started > timeoutMs) throw new Error('Condition was not met in time');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function setup(t) {
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const pool = new Pool({ connectionString: databaseUrl });
  const store = createUserStore({ databaseUrl, logger: SILENT });
  t.after(async () => {
    await store.close();
    await pool.end();
    await cleanup();
  });
  await runMigrations({ databaseUrl, logger: SILENT });
  return { databaseUrl, pool, store };
}

test('backfill marks desktop app users from sessions and login events, and only pre-release accounts as prompted', async (t) => {
  const { databaseUrl, pool, store } = await setup(t);
  const rollbackCount = rollbackCountThrough(MIGRATION);
  assert.equal(rollbackCount, 1, 'this test rolls back exactly the marker migration');

  const make = async (login, createdAt) => {
    const { user } = await store.createUser({ login, password: 'password123' });
    await pool.query(`UPDATE users SET created_at = $2, metadata = '{}'::jsonb WHERE id = $1`, [user.id, createdAt]);
    return user.id;
  };
  const sessionOnly = await make('session-only', '2026-09-01T10:00:00Z');
  const eventOnly = await make('event-only', '2026-09-02T10:00:00Z');
  const both = await make('both-sources', '2026-09-03T10:00:00Z');
  const browserOnly = await make('browser-only', '2026-09-04T10:00:00Z');
  const lateSignup = await make('late-signup', '2026-09-20T10:00:00Z');

  const insertSession = (userId, userAgent, createdAt) => pool.query(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, user_agent)
     VALUES ($1, $2, $3, $3, now() + interval '1 day', $4)`,
    [crypto.randomBytes(16).toString('hex'), userId, createdAt, userAgent]
  );
  const insertEvent = (userId, client, createdAt) => pool.query(
    `INSERT INTO account_login_events (user_id, kind, client, created_at) VALUES ($1, 'login', $2, $3)`,
    [userId, client, createdAt]
  );
  await insertSession(sessionOnly, DESKTOP_APP, '2026-09-05T08:00:00Z');
  await insertSession(sessionOnly, CHROME, '2026-09-04T08:00:00Z');
  await insertEvent(eventOnly, 'VoiceRoom Desktop', '2026-09-06T08:00:00Z');
  await insertSession(both, DESKTOP_APP, '2026-09-10T08:00:00Z');
  await insertEvent(both, 'VoiceRoom Desktop', '2026-09-07T08:00:00Z');
  await insertSession(browserOnly, CHROME, '2026-09-08T08:00:00Z');
  await insertEvent(browserOnly, 'Chrome', '2026-09-08T08:00:00Z');

  const down = await runMigrations({ databaseUrl, direction: 'down', logger: SILENT });
  assert.equal(down.length, 1);
  const up = await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal(up.length, 1);

  const cutoff = Date.parse('2026-09-16T15:00:00Z');
  const expectations = [
    [sessionOnly, Date.parse('2026-09-05T08:00:00Z'), cutoff],
    [eventOnly, Date.parse('2026-09-06T08:00:00Z'), cutoff],
    [both, Date.parse('2026-09-07T08:00:00Z'), cutoff],
    [browserOnly, undefined, cutoff],
    [lateSignup, undefined, undefined]
  ];
  for (const [userId, desktopAppSeenAt, appPromptSeenAt] of expectations) {
    const { metadata } = await metadataOf(pool, userId);
    assert.equal(metadata.desktopAppSeenAt, desktopAppSeenAt, `desktopAppSeenAt for ${userId}`);
    assert.equal(metadata.appPromptSeenAt, appPromptSeenAt, `appPromptSeenAt for ${userId}`);
  }

  // Rolling back removes both keys; re-applying never marks a late signup as prompted.
  await runMigrations({ databaseUrl, direction: 'down', logger: SILENT });
  for (const [userId] of expectations) {
    const { metadata } = await metadataOf(pool, userId);
    assert.equal('desktopAppSeenAt' in metadata || 'appPromptSeenAt' in metadata, false);
  }
  await runMigrations({ databaseUrl, logger: SILENT });
  assert.equal((await metadataOf(pool, lateSignup)).metadata.appPromptSeenAt, undefined);
});

test('a desktop session stamps the account once, and the marker outlives every session', async (t) => {
  const { pool, store } = await setup(t);
  const { user } = await store.createUser({ login: 'grace', password: 'password123' });
  assert.equal(selfUser(user).hasUsedDesktopApp, false);

  await store.createSession({ userId: user.id, userAgent: CHROME, now: 1_000 });
  assert.equal((await metadataOf(pool, user.id)).metadata.desktopAppSeenAt, undefined, 'a browser session does not stamp');

  const first = await store.createSession({ userId: user.id, userAgent: DESKTOP_APP, now: 2_000 });
  const stamped = await metadataOf(pool, user.id);
  assert.equal(stamped.metadata.desktopAppSeenAt, 2_000);

  await store.createSession({ userId: user.id, userAgent: DESKTOP_APP, now: 3_000 });
  assert.deepEqual(await metadataOf(pool, user.id), stamped, 'a second desktop login rewrites nothing');

  // Sessions go away on logout, expiry and password change; the marker stays.
  assert.equal(await store.deleteSession(first.token), true);
  await pool.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [user.id]);
  await store.pruneSessions();
  await store.changePassword({ userId: user.id, currentPassword: 'password123', newPassword: 'password456' });
  const survivor = await store.getUserById(user.id);
  assert.equal(survivor.desktopAppSeenAt, 2_000);
  assert.equal(selfUser(survivor).hasUsedDesktopApp, true);
});

test('the hourly touch stamps a session that predates the marker, without rewriting the row later', async (t) => {
  const { pool, store } = await setup(t);
  const { user } = await store.createUser({ login: 'linus', password: 'password123' });
  const session = await store.createSession({ userId: user.id, userAgent: CHROME });
  await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE id = $1`, [hashSessionToken(session.token)]);

  await store.getSessionUser(session.token, Date.now(), { userAgent: DESKTOP_APP });
  await waitFor(async () => Boolean((await metadataOf(pool, user.id)).metadata.desktopAppSeenAt));
  const stamped = await metadataOf(pool, user.id);

  await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '2 hours' WHERE id = $1`, [hashSessionToken(session.token)]);
  await store.getSessionUser(session.token, Date.now() + 5_000, { userAgent: DESKTOP_APP });
  await waitFor(async () => {
    const result = await pool.query(`SELECT last_seen_at > now() - interval '1 hour' AS touched FROM sessions WHERE id = $1`, [hashSessionToken(session.token)]);
    return result.rows[0].touched;
  });
  assert.deepEqual(await metadataOf(pool, user.id), stamped);
});

test('the app prompt is recorded once per account', async (t) => {
  const { store } = await setup(t);
  const { user } = await store.createUser({ login: 'barbara', password: 'password123' });
  assert.equal(selfUser(user).appPromptSeen, false);

  assert.deepEqual(await store.markAppPromptSeen({ userId: user.id, now: 5_000 }), { status: 'seen', appPromptSeenAt: 5_000 });
  assert.deepEqual(await store.markAppPromptSeen({ userId: user.id, now: 9_000 }), { status: 'seen', appPromptSeenAt: 5_000 });
  assert.deepEqual(await store.markAppPromptSeen({ userId: crypto.randomUUID() }), { status: 'not_found', appPromptSeenAt: null });
  assert.equal(selfUser(await store.getUserById(user.id)).appPromptSeen, true);
});

test('self-only flags never enter the public user shape other people receive', () => {
  const user = {
    id: 'u1',
    login: 'ada',
    displayName: 'Ada',
    createdAt: 1,
    avatarColorKey: 'blurple',
    presenceStatus: 'online',
    desktopAppSeenAt: 10,
    appPromptSeenAt: 20
  };
  const shared = publicUser(user);
  assert.equal('hasUsedDesktopApp' in shared, false);
  assert.equal('appPromptSeen' in shared, false);
  assert.deepEqual(selfUser(user), { ...shared, hasUsedDesktopApp: true, appPromptSeen: true });

  const server = fs.readFileSync(path.join(import.meta.dirname, '../src/server.js'), 'utf8');
  assert.match(server, /peer: publicUser\(peer\)/, 'DM peers get the public shape');
  assert.match(server, /type: 'user-updated', user: publicUser\(user\)/, 'profile broadcasts get the public shape');
  assert.match(server, /const actor = publicUser\(user\)/, 'actors get the public shape');
});

function request(socketPath, { method = 'GET', pathname, body, cookie, userAgent } = {}) {
  const payload = body === undefined ? null : JSON.stringify(body);
  const headers = { Accept: 'application/json' };
  if (payload) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  if (cookie) headers.Cookie = cookie;
  if (userAgent) headers['User-Agent'] = userAgent;
  return new Promise((resolve, reject) => {
    const req = http.request({ method, path: pathname, socketPath, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({
        status: res.statusCode,
        body: data ? JSON.parse(data) : null,
        cookie: String((res.headers['set-cookie'] || [])[0] || '').split(';')[0]
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function startServer(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-room-marker-'));
  const socketPath = socketPathForDirectory(dir);
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(import.meta.dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAX_EMPTY_ROOMS_PER_IP: '0',
      ROOM_CREATE_POW_DIFFICULTY: '0',
      ROOM_CREATE_RATE_LIMIT: '0',
      AUTH_RATE_LIMIT: '0',
      DATABASE_URL: databaseUrl,
      SOCKET_PATH: socketPath
    },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  t.after(() => {
    child.kill('SIGTERM');
    fs.rmSync(dir, { recursive: true, force: true });
    return cleanup();
  });
  const started = Date.now();
  for (;;) {
    try {
      const health = await request(socketPath, { pathname: '/api/healthz' });
      if (health.status === 200) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() - started > 15_000) throw new Error('Server did not become ready');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return socketPath;
}

test('self responses carry the flags and the app prompt endpoint records them', async (t) => {
  const socketPath = await startServer(t);
  const credentials = { login: 'hedy', password: 'password123', passwordConfirm: 'password123' };

  const registered = await request(socketPath, { method: 'POST', pathname: '/api/auth/register', body: credentials, userAgent: CHROME });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.hasUsedDesktopApp, false);
  assert.equal(registered.body.user.appPromptSeen, false);

  const fromApp = await request(socketPath, {
    method: 'POST',
    pathname: '/api/auth/login',
    body: { login: credentials.login, password: credentials.password },
    userAgent: DESKTOP_APP
  });
  assert.equal(fromApp.status, 200);
  assert.equal(fromApp.body.user.hasUsedDesktopApp, true, 'the login response is built after the session stamps the marker');

  const unauthenticated = await request(socketPath, { method: 'POST', pathname: '/api/auth/app-prompt/seen', body: {} });
  assert.equal(unauthenticated.status, 401);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const seen = await request(socketPath, { method: 'POST', pathname: '/api/auth/app-prompt/seen', body: {}, cookie: registered.cookie });
    assert.equal(seen.status, 200);
    assert.deepEqual(seen.body, { ok: true, appPromptSeen: true });
  }

  const me = await request(socketPath, { pathname: '/api/auth/me', cookie: registered.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.hasUsedDesktopApp, true);
  assert.equal(me.body.user.appPromptSeen, true);
});
