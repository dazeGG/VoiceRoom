import http from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { URL } from 'node:url';
import type pg from 'pg';
import { createDbPool } from '../../lib/db.ts';
import { createGateCredentialSigner } from './gate-credential-signer.ts';
import { createCredentialBoundaryService, type CredentialBoundaryService, type GateRoomStore } from './credential-boundary-service.ts';
import { createRoomStore } from '../../lib/room-store.js';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { createLogger } from '../../lib/logger.ts';
import { normalizeLiveKitRoomPrefix, verifyAccessTokenBinding } from './livekit-token-binding.mts';

const DEFAULT_GATE_PATH = '/rtc';
const VALIDATE_TIMEOUT_MS = 5_000;

type GateLogger = { warn(...args: unknown[]): void; error(...args: unknown[]): void };
type GateSocket = Duplex & { writable?: boolean; writableEnded?: boolean };
type GateDecision =
  | { ok: true; claims: unknown; strippedPath: string }
  | { ok: false; code: string; strippedPath: string };

function normalizeGatePath(value: unknown): string {
  const path = String(value || DEFAULT_GATE_PATH).trim();
  return path.startsWith('/') ? path : `/${path}`;
}

function cleanUpstreamUrl(value: unknown): URL {
  const parsed = new URL(String(value || 'ws://127.0.0.1:7880'));
  if (parsed.protocol !== 'ws:') throw new Error('LIVEKIT_INTERNAL_URL must be ws:// because the auth gate uses a raw TCP upstream');
  return parsed;
}

function extractCredential(requestUrl?: string): { credential: string; strippedPath: string } {
  const parsed = new URL(requestUrl || '/', 'ws://gate.local');
  const credential = parsed.searchParams.get('vr_gate_credential') || '';
  parsed.searchParams.delete('vr_gate_credential');
  return { credential, strippedPath: `${parsed.pathname}${parsed.search}` };
}

function isSocketWritable(socket: GateSocket | null | undefined): boolean {
  return Boolean(socket)
    && !socket!.destroyed
    && socket!.writable !== false
    && !socket!.writableEnded;
}

function destroySocket(socket: Duplex | null | undefined): void {
  if (socket && !socket.destroyed) socket.destroy();
}

function deny(socket: GateSocket, code = 403, reason = 'Forbidden'): void {
  if (!isSocketWritable(socket)) {
    destroySocket(socket);
    return;
  }
  const response = `HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`;
  try {
    if (typeof socket.end === 'function') socket.end(response);
    else {
      (socket as Duplex).write(response);
      destroySocket(socket);
    }
  } catch {
    destroySocket(socket);
  }
}

// livekit-client calls `<signal path>/validate` (v0 or v1) with the same query
// after a failed connect to learn why. Answering 404 made it conclude the
// server lacks v1 signaling, retry on the v0 path and report the wrong error.
function isValidatePath(requestUrl: string | undefined, gatePath: string): boolean {
  const { pathname } = new URL(requestUrl || '/', 'ws://gate.local');
  return pathname === `${gatePath}/validate` || pathname === `${gatePath}/v1/validate`;
}

function buildUpstreamUpgradeRequest({ request, strippedPath, upstream }: {
  request: http.IncomingMessage;
  strippedPath: string;
  upstream: URL;
}): string {
  const headers: Record<string, string | string[] | undefined> = { ...request.headers };
  delete headers['vr_gate_credential'];
  delete headers['x-vr-gate-credential'];
  headers.host = upstream.host;
  const lines = [`GET ${strippedPath || DEFAULT_GATE_PATH} HTTP/1.1`];
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) lines.push(`${key}: ${item}`);
    } else if (value !== undefined) {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push('\r\n');
  return lines.join('\r\n');
}

function createLiveKitAuthGateService({
  boundary,
  databaseUrl,
  gatePath = DEFAULT_GATE_PATH,
  logger = createLogger({ name: 'api' }),
  pool,
  roomPrefix = normalizeLiveKitRoomPrefix(),
  roomStore,
  secret,
  upstreamUrl = process.env.LIVEKIT_INTERNAL_URL || process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880'
}: {
  boundary?: Pick<CredentialBoundaryService, 'authorizeCredential' | 'assertReady'>;
  databaseUrl?: string;
  gatePath?: string;
  logger?: GateLogger;
  pool?: pg.Pool | Record<string, unknown> | null;
  roomPrefix?: string;
  roomStore?: GateRoomStore | Record<string, unknown>;
  secret?: unknown;
  upstreamUrl?: string;
} = {}) {
  const path = normalizeGatePath(gatePath);
  const upstream = cleanUpstreamUrl(upstreamUrl);
  const activePool = roomStore ? null : (pool || createDbPool({ databaseUrl, logger }));
  // room-store.js is untyped and its inferred options miss `pool`; typed with the stores in PR 10h.
  const store = (roomStore || createRoomStore({ pool: activePool, logger } as unknown as Parameters<typeof createRoomStore>[0])) as GateRoomStore;
  const credentialBoundary = boundary || createCredentialBoundaryService({
    roomStore: store,
    signer: createGateCredentialSigner({ secret })
  });

  // With `headers` the LiveKit JWT that rides along must belong to the same
  // admission as the gate credential (see livekit-token-binding.js). The
  // upgrade handler always passes them; credential-only callers are proofs that
  // exercise the boundary service in isolation.
  async function authorize(requestUrl?: string, headers?: http.IncomingHttpHeaders): Promise<GateDecision> {
    const { credential, strippedPath } = extractCredential(requestUrl);
    const result = await credentialBoundary.authorizeCredential(credential);
    if (!result.ok) return { ok: false, code: result.code, strippedPath };
    if (headers !== undefined) {
      const binding = verifyAccessTokenBinding({ claims: result.claims, requestUrl, headers, roomPrefix });
      if (!binding.ok) return { ok: false, code: binding.code, strippedPath };
    }
    return { ok: true, claims: result.claims, strippedPath };
  }

  function createServer(): http.Server {
    const server = http.createServer((req, res) => {
      if (req.url === '/readyz') {
        credentialBoundary.assertReady()
          .then(() => {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          })
          .catch(() => {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
          });
        return;
      }
      if (req.method === 'GET' && isValidatePath(req.url, path)) {
        proxyValidate(req, res);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.on('upgrade', (request: http.IncomingMessage, socket: GateSocket, head: Buffer) => {
      // Client cancellations are normal during navigation/reconnect. Without an
      // error listener, a late write can terminate the whole gate process.
      socket.on('error', () => {});
      if (!String(request.url || '').startsWith(path)) {
        deny(socket, 404, 'Not Found');
        return;
      }
      // An IncomingMessage always carries its headers.
      authorize(request.url, request.headers)
        .then((decision) => {
          if (!decision.ok) {
            logger.warn({ evt: LOG_EVENTS.LIVEKIT_GATE_DENIED, code: decision.code }, 'LiveKit gate denied an upgrade');
            deny(socket, 403, 'Forbidden');
            return;
          }
          if (!isSocketWritable(socket)) return;
          const upstreamSocket = net.connect({
            noDelay: true,
            host: upstream.hostname,
            port: Number(upstream.port || (upstream.protocol === 'wss:' ? 443 : 80))
          });
          let tunnelEstablished = false;
          const closeUpstream = () => destroySocket(upstreamSocket);
          socket.once('close', closeUpstream);
          socket.once('end', closeUpstream);
          upstreamSocket.once('connect', () => {
            if (!isSocketWritable(socket)) {
              closeUpstream();
              return;
            }
            try {
              upstreamSocket.write(buildUpstreamUpgradeRequest({ request, strippedPath: decision.strippedPath, upstream }));
              if (head?.length) upstreamSocket.write(head);
              tunnelEstablished = true;
              socket.pipe(upstreamSocket);
              upstreamSocket.pipe(socket);
            } catch (error) {
              logger.error({ evt: LOG_EVENTS.LIVEKIT_GATE_UPSTREAM_FAILED, err: error }, 'LiveKit gate upstream connection failed');
              destroySocket(socket);
              closeUpstream();
            }
          });
          upstreamSocket.once('error', (error) => {
            if (!tunnelEstablished) {
              logger.error({ evt: LOG_EVENTS.LIVEKIT_GATE_UPSTREAM_FAILED, err: error }, 'LiveKit gate upstream connection failed');
              deny(socket, 503, 'Service Unavailable');
            } else {
              destroySocket(socket);
            }
            closeUpstream();
          });
          upstreamSocket.once('close', () => destroySocket(socket));
        })
        .catch((error: unknown) => {
          logger.error({ evt: LOG_EVENTS.LIVEKIT_GATE_AUTHORIZATION_FAILED, err: error }, 'LiveKit gate authorization failed');
          deny(socket, 503, 'Service Unavailable');
        });
    });
    return server;
  }

  // The validate probe gets the same admission check as the upgrade itself, so
  // a revoked or mismatched admission hears 403 (LiveKit's "not allowed")
  // instead of whatever LiveKit would say about the bare JWT.
  // The probe is a cross-origin fetch from the web origin to the LiveKit
  // domain without cookies (the admission rides in the URL), so the browser
  // only lets the client read the answer with an allow-origin header.
  function proxyValidate(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.setHeader('access-control-allow-origin', '*');
    authorize(req.url, req.headers)
      .then((decision) => {
        if (!decision.ok) {
          res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
          res.end('LiveKit admission is no longer valid');
          return;
        }
        const headers: http.OutgoingHttpHeaders = { ...req.headers, host: upstream.host };
        delete headers['x-vr-gate-credential'];
        const upstreamRequest = http.request({
          headers,
          host: upstream.hostname,
          method: 'GET',
          path: decision.strippedPath,
          port: Number(upstream.port || 80),
          timeout: VALIDATE_TIMEOUT_MS
        }, (upstreamResponse) => {
          res.writeHead(upstreamResponse.statusCode || 502, {
            'content-type': upstreamResponse.headers['content-type'] || 'text/plain; charset=utf-8'
          });
          upstreamResponse.pipe(res);
        });
        upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('validate timed out')));
        upstreamRequest.on('error', (error) => {
          logger.error({ evt: LOG_EVENTS.LIVEKIT_GATE_UPSTREAM_FAILED, err: error }, 'LiveKit gate validate failed');
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        upstreamRequest.end();
      })
      .catch((error: unknown) => {
        logger.error({ evt: LOG_EVENTS.LIVEKIT_GATE_AUTHORIZATION_FAILED, err: error }, 'LiveKit gate authorization failed');
        res.writeHead(503);
        res.end();
      });
  }

  return {
    authorize,
    createServer,
    path,
    upstream
  };
}

export { DEFAULT_GATE_PATH, createLiveKitAuthGateService, extractCredential };

if (import.meta.main) {
  const logger = createLogger({ name: 'livekit-auth-gate' });
  try {
    const service = createLiveKitAuthGateService({
      databaseUrl: process.env.DATABASE_URL,
      gatePath: process.env.LIVEKIT_GATE_PATH || DEFAULT_GATE_PATH,
      logger,
      secret: process.env.LIVEKIT_GATE_SECRET,
      upstreamUrl: process.env.LIVEKIT_INTERNAL_URL || 'ws://127.0.0.1:7880'
    });
    const port = Number(process.env.LIVEKIT_GATE_PORT || 3080);
    const host = process.env.LIVEKIT_GATE_HOST || '0.0.0.0';
    service.createServer().listen(port, host, () => {
      logger.info({ evt: LOG_EVENTS.LISTENING, service: 'livekit-auth-gate', host, port, path: service.path }, 'LiveKit auth gate listening');
    });
  } catch (error) {
    logger.fatal({ evt: LOG_EVENTS.BOOTSTRAP_FAILED, service: 'livekit-auth-gate', err: error }, 'LiveKit auth gate failed to start');
    // The logger is silent unless LOG_LEVEL is set, and a process that refuses
    // to start must still tell the operator why.
    process.stderr.write(`LiveKit auth gate failed to start: ${(error as Error | null)?.stack || error}
`);
    process.exitCode = 1;
  }
}
