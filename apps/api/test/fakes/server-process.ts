// An API server started as its own process on a Unix socket (a named pipe on
// Windows), and a JSON client for it. Tests that need the real process
// boundary (spawned server.ts, real PostgreSQL) share these instead of
// carrying private copies.

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
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
  cookie?: string;
  headers?: Record<string, string>;
};

export function request<Body = ApiBody>(
  socketPath: string,
  { method = 'GET', pathname, body, cookie, headers: extra = {} }: RequestOptions
): Promise<JsonResponse<Body>> {
  const payload = body === undefined ? null : JSON.stringify(body);
  const headers: Record<string, string | number> = { Accept: 'application/json', ...extra };
  if (payload) {
    headers['Content-Type'] = 'application/json';
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
