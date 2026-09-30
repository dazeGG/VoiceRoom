// An API server started as its own process on a Unix socket (a named pipe on
// Windows), and a JSON client for it. Tests that need the real process
// boundary (spawned server.ts, real PostgreSQL) share these instead of
// carrying private copies.

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { TestContext } from 'node:test';
import type { SignedIn } from '@voice-room/shared/contracts/account';
import type { FriendRequests } from '@voice-room/shared/contracts/social';
import { createTestDatabase } from '../db-harness.ts';
import { socketPathForDirectory } from '../ipc-harness.ts';

export type ServerLogs = { stdout: string; stderr: string };

/** A fresh directory and the socket path inside it. */
export function socketDir(prefix = 'voice-room-sock-'): { dir: string; socketPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, socketPath: socketPathForDirectory(dir) };
}

export function waitForHealthz(socketPath: string, timeoutMs = 15000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get({ path: '/api/healthz', socketPath }, (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
            return;
          }
          retry();
        })
        .on('error', retry);
    };
    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Server did not become ready'));
        return;
      }
      setTimeout(attempt, 50);
    };
    attempt();
  });
}

/**
 * Spawns src/server.ts on `socketPath` against `databaseUrl`. Room creation
 * limits are off; `env` adds or overrides variables. Output is appended to
 * `logs` so a failing test can print it.
 */
export function startServer(
  socketPath: string,
  databaseUrl: string,
  logs: ServerLogs,
  env: Record<string, string> = {}
): ChildProcess & { stdout: NonNullable<ChildProcess['stdout']>; stderr: NonNullable<ChildProcess['stderr']> } {
  const child = spawn(process.execPath, ['src/server.ts'], {
    cwd: path.join(import.meta.dirname, '../..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MAX_EMPTY_ROOMS_PER_IP: '0',
      ROOM_CREATE_POW_DIFFICULTY: '0',
      ROOM_CREATE_RATE_LIMIT: '0',
      DATABASE_URL: databaseUrl,
      SOCKET_PATH: socketPath,
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk: Buffer) => {
    logs.stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    logs.stderr += chunk.toString();
  });
  return child;
}

/**
 * The envelope every API response shares. A test that reads more names the
 * shape it expects: `request<{ user: { id: string } }>(...)`.
 */
export type ApiBody = { ok?: boolean; code?: string; error?: string; [key: string]: unknown };

export type JsonResponse<Body = ApiBody> = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Body & ApiBody;
  setCookie: string[];
};

export type RequestOptions = {
  method?: string;
  pathname: string;
  body?: unknown;
  /** Sent as is instead of a JSON body; `headers` names its content type. */
  rawBody?: Buffer;
  cookie?: string;
  headers?: Record<string, string>;
};

export function request<Body = ApiBody>(
  socketPath: string,
  { method = 'GET', pathname, body, rawBody, cookie, headers: extra = {} }: RequestOptions
): Promise<JsonResponse<Body>> {
  const payload = rawBody ?? (body === undefined ? null : JSON.stringify(body));
  const headers: Record<string, string | number> = { Accept: 'application/json', ...extra };
  if (payload) {
    if (!rawBody) headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }
  if (cookie) headers.Cookie = cookie;

  return new Promise((resolve, reject) => {
    const req = http.request({ method, path: pathname, socketPath, headers }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        let parsed: unknown;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch {
          parsed = data;
        }
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: parsed as Body & ApiBody,
          setCookie: res.headers['set-cookie'] ?? []
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Reduces a Set-Cookie header to the `name=value` Cookie string for the next call. */
export function cookieFrom(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return String(header || '').split(';')[0] ?? '';
}

export function postJson<Body = ApiBody>(
  socketPath: string,
  pathname: string,
  body: unknown = {},
  cookie?: string
): Promise<JsonResponse<Body>> {
  return request<Body>(socketPath, { method: 'POST', pathname, body, cookie });
}

export function getJson<Body = ApiBody>(socketPath: string, pathname: string, cookie?: string) {
  return request<Body>(socketPath, { pathname, cookie });
}

/** Prints what the server wrote, for a test that is about to fail. */
export function dumpServerLogs(logs: ServerLogs): void {
  if (logs.stderr.trim()) console.error('Server stderr:\n', logs.stderr.trimEnd());
  if (logs.stdout.trim()) console.error('Server stdout:\n', logs.stdout.trimEnd());
}

export const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A server process on a fresh database for this test, stopped and cleaned up
 * after it; resolves once /api/healthz answers.
 */
export async function startApiServer(
  t: TestContext,
  { prefix, env = {} }: { prefix?: string; env?: Record<string, string> } = {}
): Promise<{
  socketPath: string;
  databaseUrl: string;
  logs: ServerLogs;
  /** Runs before the database is dropped, e.g. to end the test's own pool. */
  beforeCleanup: (stop: () => unknown) => void;
}> {
  const { dir, socketPath } = socketDir(prefix);
  const { cleanup, databaseUrl } = await createTestDatabase(t);
  const logs: ServerLogs = { stdout: '', stderr: '' };
  const child = startServer(socketPath, databaseUrl, logs, env);
  const stops: Array<() => unknown> = [];
  t.after(async () => {
    child.kill('SIGTERM');
    for (const stop of stops) await stop();
    fs.rmSync(dir, { recursive: true, force: true });
    await cleanup();
  });
  await waitForHealthz(socketPath);
  return { socketPath, databaseUrl, logs, beforeCleanup: (stop) => stops.push(stop) };
}

/** Registers `login` (password 'password123') and returns its session cookie. */
export async function registerAccount(socketPath: string, login: string): Promise<string> {
  const response = await request<SignedIn>(socketPath, {
    method: 'POST',
    pathname: '/api/auth/register',
    body: { login, displayName: login, password: 'password123', passwordConfirm: 'password123' }
  });
  assert.equal(response.status, 201);
  return cookieFrom(response.setCookie);
}

/** Sends a friend request from the account behind `requesterCookie`. */
export async function sendFriendRequest(socketPath: string, requesterCookie: string, addresseeLogin: string) {
  const response = await request(socketPath, {
    method: 'POST',
    pathname: '/api/friends/requests',
    cookie: requesterCookie,
    body: { login: addresseeLogin }
  });
  assert.ok(response.status === 200 || response.status === 201);
  return response.body;
}

/** Accepts the oldest incoming friend request of the account behind `cookie`. */
export async function acceptFirstFriendRequest(socketPath: string, cookie: string): Promise<void> {
  const list = await request<FriendRequests>(socketPath, { pathname: '/api/friends/requests', cookie });
  assert.equal(list.status, 200);
  const requestId = list.body.incoming[0]?.id;
  assert.ok(requestId);
  const accepted = await request(socketPath, {
    method: 'POST',
    pathname: `/api/friends/requests/${encodeURIComponent(requestId)}/accept`,
    cookie,
    body: {}
  });
  assert.equal(accepted.status, 200);
}
