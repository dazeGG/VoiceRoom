import http from 'node:http';
import { createWidgetRuntimeOwner, type WidgetRuntimeOwner } from '../rooms/widget-runtime-owner.repository.ts';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { URL } from 'node:url';
import { RoomServiceClient } from 'livekit-server-sdk';
import type pg from 'pg';
import { createDbPool } from '../../platform/db/pool.ts';
import { readDatabaseConfig } from '../../lib/config.ts';
import { createGateCredentialSigner } from './gate-credential-signer.ts';
import {
  createCredentialBoundaryService,
  type CredentialBoundaryService,
  type GateRoomStore
} from './credential-boundary.service.ts';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { createGateCredentialRepository } from './gate-credential.repository.ts';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { createLogger } from '../../lib/logger.ts';
import { DEFAULT_ROOM_PREFIX, getLiveKitRoomName, verifyAccessTokenBinding } from './livekit-token-binding.mts';
import { readLiveKitGateConfig } from '../../app/config.ts';
import { createPersonalLogger } from '../../platform/personal-logger.ts';
import { createNativeVoiceRepository } from './native-voice.repository.ts';
import { createNativeVoiceRecovery } from './native-voice-recovery.service.ts';
import { isUuid, nativeVoiceIdentity } from '@voiceroom/shared/validation';
import { NATIVE_VOICE_ADMIN_TIMEOUT_SECONDS, removeNativeVoiceParticipant } from './livekit-admin.ts';
import { liveKitHttpUrl } from './livekit-config.ts';
import { createNativeVoiceWatchdog, type CompanionWindow } from './native-voice-watchdog.service.ts';

const DEFAULT_GATE_PATH = '/rtc';
const VALIDATE_TIMEOUT_MS = 5_000;

type GateLogger = { warn(...args: unknown[]): void; error(...args: unknown[]): void };
type GateSocket = Duplex & { writable?: boolean; writableEnded?: boolean };
type GateDecision =
  | {
      ok: true;
      claims: unknown;
      strippedPath: string;
      widget?: boolean;
      generation?: string;
      companion?: CompanionWindow;
    }
  | { ok: false; code: string; strippedPath: string };

function normalizeGatePath(value: string): string {
  const path = (value || DEFAULT_GATE_PATH).trim();
  return path.startsWith('/') ? path : `/${path}`;
}

function cleanUpstreamUrl(value: string): URL {
  const parsed = new URL(value || 'ws://127.0.0.1:7880');
  if (parsed.protocol !== 'ws:')
    throw new Error('LIVEKIT_INTERNAL_URL must be ws:// because the auth gate uses a raw TCP upstream');
  return parsed;
}

function extractCredential(requestUrl?: string): { credential: string; strippedPath: string } {
  const parsed = new URL(requestUrl || '/', 'ws://gate.local');
  const credential = parsed.searchParams.get('vr_gate_credential') || '';
  parsed.searchParams.delete('vr_gate_credential');
  return { credential, strippedPath: `${parsed.pathname}${parsed.search}` };
}

function isSocketWritable(socket: GateSocket | null | undefined): boolean {
  return !!socket && !socket.destroyed && socket.writable !== false && !socket.writableEnded;
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
      socket.write(response);
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

function buildUpstreamUpgradeRequest({
  request,
  strippedPath,
  upstream
}: {
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
  apiKey,
  apiSecret,
  boundary,
  gatePath = DEFAULT_GATE_PATH,
  logger = createLogger({ name: 'api' }),
  pool,
  roomPrefix = DEFAULT_ROOM_PREFIX,
  roomStore,
  secret,
  superviseWidgets = true,
  upstreamUrl = process.env.LIVEKIT_INTERNAL_URL || process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880'
}: {
  apiKey?: string;
  apiSecret?: string;
  boundary?: Pick<CredentialBoundaryService, 'authorizeCredential' | 'assertReady'>;
  gatePath?: string;
  logger?: GateLogger;
  pool?: pg.Pool | null;
  roomPrefix?: string;
  roomStore?: GateRoomStore | undefined;
  secret?: unknown;
  superviseWidgets?: boolean;
  upstreamUrl?: string;
} = {}) {
  const path = normalizeGatePath(gatePath);
  const upstream = cleanUpstreamUrl(upstreamUrl);
  // Tests that hand in their own boundary pass an empty room store.
  const store = roomStore || (pool ? createGateCredentialRepository({ db: kyselyOn(pool) }) : null);
  if (!store) throw new Error('The LiveKit auth gate needs a room store or a pool');
  const credentialBoundary =
    boundary ||
    createCredentialBoundaryService({
      roomStore: store,
      signer: createGateCredentialSigner({ secret })
    });
  const nativeVoice = pool ? createNativeVoiceRepository(kyselyOn(pool)) : null;
  const admin =
    apiKey && apiSecret
      ? new RoomServiceClient(liveKitHttpUrl(upstream.origin), apiKey, apiSecret, {
          requestTimeout: NATIVE_VOICE_ADMIN_TIMEOUT_SECONDS,
          failover: false
        })
      : null;
  const watchdog = admin
    ? createNativeVoiceWatchdog({
        remove: (room, identity) => removeNativeVoiceParticipant(admin, getLiveKitRoomName(room, roomPrefix), identity),
        report: (err, { room: roomId, identity }, final) =>
          logger.error(
            {
              evt: final ? LOG_EVENTS.NATIVE_VOICE_GATE_CLEANUP_EXHAUSTED : LOG_EVENTS.NATIVE_VOICE_GATE_CLEANUP_FAILED,
              roomId,
              identity,
              err
            },
            'native voice gate cleanup failed'
          )
      })
    : null;
  const recovery =
    admin && watchdog
      ? createNativeVoiceRecovery({
          admin,
          repository: nativeVoice,
          roomPrefix,
          watchdog,
          report: (err) =>
            logger.error(
              { evt: LOG_EVENTS.NATIVE_VOICE_GATE_DISCOVERY_FAILED, err },
              'native voice gate discovery failed'
            )
        })
      : null;

  type Pending = {
    kind: 'unknown' | 'main' | 'widget' | 'companion';
    cancelled: boolean;
    client: GateSocket;
    upstream?: net.Socket;
  };
  const pending = new Set<Pending>();
  function cancel(token: Pending): void {
    token.cancelled = true;
    destroySocket(token.client);
    destroySocket(token.upstream);
    pending.delete(token);
  }
  function cutWidgets(): void {
    for (const token of pending) if (token.kind === 'widget') cancel(token);
  }
  async function quiesce(): Promise<boolean> {
    cutWidgets();
    return ![...pending].some((token) => token.kind === 'unknown');
  }
  const owner: WidgetRuntimeOwner | null =
    pool && superviseWidgets ? createWidgetRuntimeOwner({ pool, role: 'gate', quiesce, lost: cutWidgets }) : null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let sweep: Promise<void> | null = null;
  let started = false;
  let ownerStarted = false;
  function sweepOwner(): Promise<void> {
    if (sweep) return sweep;
    sweep = (async () => {
      if (!ownerStarted) {
        // The API applies migrations after this process can start. Retry an
        // unsuccessful bootstrap, but never reacquire a lost runtime owner.
        await owner?.start();
        ownerStarted = true;
      } else {
        await owner?.tick();
      }
    })()
      .catch(() => cutWidgets())
      .finally(() => {
        sweep = null;
      });
    return sweep;
  }
  async function start(): Promise<void> {
    if (started) return;
    started = true;
    watchdog?.start();
    recovery?.start();
    if (!owner) return;
    timer = setInterval(() => void sweepOwner(), 250);
    timer.unref();
    await sweepOwner();
  }
  async function stop(): Promise<void> {
    if (timer) clearInterval(timer);
    recovery?.stop();
    watchdog?.stop();
    await sweep;
    for (const token of pending) cancel(token);
    await owner?.stop();
  }

  // With `headers` the LiveKit JWT that rides along must belong to the same
  // admission as the gate credential (see livekit-token-binding.js). The
  // upgrade handler always passes them; credential-only callers are proofs that
  // exercise the boundary service in isolation.
  async function authorize(requestUrl?: string, headers?: http.IncomingHttpHeaders): Promise<GateDecision> {
    const { credential, strippedPath } = extractCredential(requestUrl);
    const result = await credentialBoundary.authorizeCredential(credential);
    if (!result.ok) return { ok: false, code: result.code, strippedPath };
    if (headers !== undefined || result.claims.companion) {
      const binding = verifyAccessTokenBinding({
        claims: result.claims,
        requestUrl,
        headers: headers ?? {},
        roomPrefix
      });
      if (!binding.ok) return { ok: false, code: binding.code, strippedPath };
    }
    if (result.claims.companion) {
      const { cid, room, peer } = result.claims;
      const window = watchdog && isUuid(cid) ? await nativeVoice?.window(result.claims) : null;
      if (window) {
        const companion = { room, identity: nativeVoiceIdentity(peer, cid), ...window };
        if (watchdog?.allows(companion)) return { ok: true, claims: result.claims, strippedPath, companion };
      }
      return { ok: false, code: 'companion_unavailable', strippedPath };
    }
    if (pool) {
      const room = await pool.query<{ kind: string }>('SELECT kind FROM rooms WHERE id=$1 AND deleted_at IS NULL', [
        result.claims.room
      ]);
      if (!room.rows[0] || room.rows[0].kind === 'call') return { ok: false, code: 'room_not_found', strippedPath };
      if (room.rows[0].kind === 'widget') {
        const generation = await owner?.capture();
        if (generation === null || generation === undefined)
          return { ok: false, code: 'widget_unavailable', strippedPath };
        return { ok: true, claims: result.claims, strippedPath, widget: true, generation };
      }
    }
    return { ok: true, claims: result.claims, strippedPath };
  }

  async function refreshCompanion(credential: string) {
    const authorization = await credentialBoundary.authorizeCredential(credential);
    if (!authorization.ok || !nativeVoice) return null;
    return nativeVoice.window(authorization.claims);
  }

  function createServer(): http.Server {
    const server = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/metrics' && watchdog) {
        const { watches, exhausted } = watchdog.metrics();
        res
          .writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
          .end(
            [
              '# TYPE voice_room_livekit_gate_native_voice_watches gauge',
              `voice_room_livekit_gate_native_voice_watches ${watches}`,
              '# TYPE voice_room_livekit_gate_native_voice_cleanup_exhausted_total counter',
              `voice_room_livekit_gate_native_voice_cleanup_exhausted_total ${exhausted}`,
              ''
            ].join('\n')
          );
        return;
      }
      if (req.url === '/readyz') {
        credentialBoundary
          .assertReady()
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
      if (!(request.url || '').startsWith(path)) {
        deny(socket, 404, 'Not Found');
        return;
      }
      const token: Pending = { kind: 'unknown', cancelled: false, client: socket };
      pending.add(token);
      const authTimeout = setTimeout(() => cancel(token), VALIDATE_TIMEOUT_MS);
      authTimeout.unref();
      socket.once('close', () => {
        clearTimeout(authTimeout);
        cancel(token);
      });
      // An IncomingMessage always carries its headers.
      authorize(request.url, request.headers)
        .then((decision) => {
          clearTimeout(authTimeout);
          if (token.cancelled) return;
          if (!decision.ok) {
            logger.warn({ evt: LOG_EVENTS.LIVEKIT_GATE_DENIED, code: decision.code }, 'LiveKit gate denied an upgrade');
            pending.delete(token);
            deny(socket, 403, 'Forbidden');
            return;
          }
          token.kind = decision.companion ? 'companion' : decision.widget ? 'widget' : 'main';
          if (token.kind === 'main') pending.delete(token);
          if (!isSocketWritable(socket) || token.cancelled) return;
          const upstreamSocket = net.connect({
            noDelay: true,
            host: upstream.hostname,
            port: Number(upstream.port || (upstream.protocol === 'wss:' ? 443 : 80))
          });
          token.upstream = upstreamSocket;
          let tunnelEstablished = false;
          const closeUpstream = () => destroySocket(upstreamSocket);
          socket.once('close', closeUpstream);
          socket.once('end', closeUpstream);
          upstreamSocket.once('connect', () => {
            void (async () => {
              if (!isSocketWritable(socket) || token.cancelled) {
                closeUpstream();
                return;
              }
              try {
                if (decision.companion) {
                  const fresh = await authorize(request.url, request.headers);
                  if (!fresh.ok || fresh.companion?.identity !== decision.companion.identity || token.cancelled) {
                    cancel(token);
                    return;
                  }
                  const { credential } = extractCredential(request.url);
                  const untrack = watchdog?.track(
                    fresh.companion,
                    () => refreshCompanion(credential),
                    () => cancel(token)
                  );
                  if (!untrack) {
                    cancel(token);
                    return;
                  }
                  socket.once('close', untrack);
                }
                if (decision.widget) {
                  if (
                    !owner ||
                    decision.generation === undefined ||
                    !(await owner.allows(decision.generation)) ||
                    token.cancelled
                  ) {
                    cancel(token);
                    return;
                  }
                  const fresh = await authorize(request.url, request.headers);
                  if (
                    !fresh.ok ||
                    !fresh.widget ||
                    fresh.generation !== decision.generation ||
                    !(await owner.allows(decision.generation)) ||
                    !owner.localEnabled() ||
                    token.cancelled
                  ) {
                    cancel(token);
                    return;
                  }
                }
                upstreamSocket.write(
                  buildUpstreamUpgradeRequest({ request, strippedPath: decision.strippedPath, upstream })
                );
                if (head?.length) upstreamSocket.write(head);
                tunnelEstablished = true;
                socket.pipe(upstreamSocket);
                upstreamSocket.pipe(socket);
              } catch (error) {
                logger.error(
                  { evt: LOG_EVENTS.LIVEKIT_GATE_UPSTREAM_FAILED, err: error },
                  'LiveKit gate upstream connection failed'
                );
                destroySocket(socket);
                closeUpstream();
              }
            })().catch(() => cancel(token));
          });
          upstreamSocket.once('error', (error) => {
            if (!tunnelEstablished) {
              logger.error(
                { evt: LOG_EVENTS.LIVEKIT_GATE_UPSTREAM_FAILED, err: error },
                'LiveKit gate upstream connection failed'
              );
              deny(socket, 503, 'Service Unavailable');
            } else {
              destroySocket(socket);
            }
            closeUpstream();
          });
          upstreamSocket.once('close', () => destroySocket(socket));
        })
        .catch((error: unknown) => {
          clearTimeout(authTimeout);
          pending.delete(token);
          logger.error(
            { evt: LOG_EVENTS.LIVEKIT_GATE_AUTHORIZATION_FAILED, err: error },
            'LiveKit gate authorization failed'
          );
          deny(socket, 503, 'Service Unavailable');
        });
    });
    server.once('listening', () => void start().catch(() => cutWidgets()));
    server.once('close', () => void stop());
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
        const upstreamRequest = http.request(
          {
            headers,
            host: upstream.hostname,
            method: 'GET',
            path: decision.strippedPath,
            port: Number(upstream.port || 80),
            timeout: VALIDATE_TIMEOUT_MS
          },
          (upstreamResponse) => {
            res.writeHead(upstreamResponse.statusCode || 502, {
              'content-type': upstreamResponse.headers['content-type'] || 'text/plain; charset=utf-8'
            });
            upstreamResponse.pipe(res);
          }
        );
        upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('validate timed out')));
        upstreamRequest.on('error', (error) => {
          logger.error({ evt: LOG_EVENTS.LIVEKIT_GATE_UPSTREAM_FAILED, err: error }, 'LiveKit gate validate failed');
          if (!res.headersSent) res.writeHead(502);
          res.end();
        });
        upstreamRequest.end();
      })
      .catch((error: unknown) => {
        logger.error(
          { evt: LOG_EVENTS.LIVEKIT_GATE_AUTHORIZATION_FAILED, err: error },
          'LiveKit gate authorization failed'
        );
        res.writeHead(503);
        res.end();
      });
  }

  return {
    authorize,
    start,
    stop,
    createServer,
    path,
    upstream
  };
}

// SIGTERM: stop listening, cut every client connection (proxied signal
// sockets included; the proxy drops their upstream side with them), close the
// pool and exit. LiveKit clients resume through the next gate on their own, so
// there is nothing to wait for, and a deploy waits for this process to exit.
function installGateShutdown(
  server: http.Server,
  options: {
    logger: Pick<ReturnType<typeof createLogger>, 'info' | 'error'>;
    closePool: () => Promise<void>;
    exit?: (code: number) => void;
    timeoutMs?: number;
    signals?: { once(signal: NodeJS.Signals, listener: () => void): unknown };
  }
): (signal: string) => Promise<void> {
  const {
    logger,
    closePool,
    exit = (code: number) => process.exit(code),
    timeoutMs = 3000,
    signals = process
  } = options;
  const connections = new Set<net.Socket>();
  server.on('connection', (socket: net.Socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    const started = Date.now();
    logger.info({ evt: LOG_EVENTS.SHUTDOWN_STARTED, service: 'livekit-auth-gate', signal }, 'shutting down');
    const timeout = setTimeout(() => {
      logger.error({ evt: LOG_EVENTS.SHUTDOWN_TIMEOUT, service: 'livekit-auth-gate', timeoutMs }, 'shutdown timed out');
      exit(1);
    }, timeoutMs);
    timeout.unref?.();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    const cut = connections.size;
    for (const socket of connections) destroySocket(socket);
    try {
      await closed;
      await closePool();
      clearTimeout(timeout);
      logger.info(
        {
          evt: LOG_EVENTS.SHUTDOWN_COMPLETED,
          service: 'livekit-auth-gate',
          connections: cut,
          ms: Date.now() - started
        },
        'shut down'
      );
      exit(0);
    } catch (error) {
      clearTimeout(timeout);
      logger.error({ evt: LOG_EVENTS.SHUTDOWN_FAILED, service: 'livekit-auth-gate', err: error }, 'shutdown failed');
      exit(1);
    }
  }

  signals.once('SIGTERM', () => void shutdown('SIGTERM'));
  signals.once('SIGINT', () => void shutdown('SIGINT'));
  return shutdown;
}

export { DEFAULT_GATE_PATH, createLiveKitAuthGateService, extractCredential, installGateShutdown };

// Phase 4 moves this entry out of the domain: it reads process.env and opens
// a pool here, which only src/app should do.
if (import.meta.main) {
  const env = process.env;
  const { host, port, ...config } = readLiveKitGateConfig(env);
  const name = 'livekit-auth-gate';
  const logger = config.superviseWidgets ? createLogger({ env, name }) : createPersonalLogger({ env, name });
  try {
    const pool = createDbPool({ databaseUrl: readDatabaseConfig(env).url, logger });
    const service = createLiveKitAuthGateService({ pool, logger, ...config });
    const server = service.createServer();
    installGateShutdown(server, { logger, closePool: () => pool.end() });
    server.listen(port, host, () => {
      logger.info(
        { evt: LOG_EVENTS.LISTENING, service: 'livekit-auth-gate', host, port, path: service.path },
        'LiveKit auth gate listening'
      );
    });
  } catch (error) {
    logger.fatal(
      { evt: LOG_EVENTS.BOOTSTRAP_FAILED, service: 'livekit-auth-gate', err: error },
      'LiveKit auth gate failed to start'
    );
    // The logger is silent unless LOG_LEVEL is set, and a process that refuses
    // to start must still tell the operator why.
    const detail = config.superviseWidgets && error instanceof Error ? `: ${error.message}` : '';
    process.stderr.write(`LiveKit auth gate failed to start${detail}\n`);
    process.exitCode = 1;
  }
}
