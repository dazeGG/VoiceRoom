'use strict';

const http = require('node:http');
const net = require('node:net');
const { URL } = require('node:url');
const { createDbPool } = require('../../lib/db');
const { createGateCredentialSigner } = require('./gate-credential-signer');
const { createRoomStore } = require('../../lib/room-store');

const DEFAULT_GATE_PATH = '/rtc';

function normalizeGatePath(value) {
  const path = String(value || DEFAULT_GATE_PATH).trim();
  return path.startsWith('/') ? path : `/${path}`;
}

function cleanUpstreamUrl(value) {
  const parsed = new URL(String(value || 'ws://127.0.0.1:7880'));
  if (!['ws:', 'wss:'].includes(parsed.protocol)) throw new Error('LIVEKIT_INTERNAL_URL must be ws:// or wss://');
  return parsed;
}

function extractCredential(requestUrl) {
  const parsed = new URL(requestUrl || '/', 'ws://gate.local');
  const credential = parsed.searchParams.get('vr_gate_credential') || '';
  parsed.searchParams.delete('vr_gate_credential');
  return { credential, strippedPath: `${parsed.pathname}${parsed.search}` };
}

function deny(socket, code = 403, reason = 'Forbidden') {
  socket.write(`HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function buildUpstreamUpgradeRequest({ request, strippedPath, upstream }) {
  const headers = { ...request.headers };
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
  databaseUrl,
  gatePath = DEFAULT_GATE_PATH,
  logger = console,
  pool,
  roomStore,
  secret,
  upstreamUrl = process.env.LIVEKIT_INTERNAL_URL || process.env.LIVEKIT_URL || 'ws://127.0.0.1:7880'
} = {}) {
  const path = normalizeGatePath(gatePath);
  const upstream = cleanUpstreamUrl(upstreamUrl);
  const signer = createGateCredentialSigner({ secret });
  const activePool = roomStore ? null : (pool || createDbPool({ databaseUrl, logger }));
  const store = roomStore || createRoomStore({ pool: activePool, logger });

  async function authorize(requestUrl) {
    const { credential, strippedPath } = extractCredential(requestUrl);
    const verified = signer.verify(credential);
    if (!verified.ok) return { ok: false, code: verified.code, strippedPath };
    const result = await store.verifyLiveKitGateCredential({
      credentialHash: signer.hash(credential),
      peerId: verified.claims.peer,
      principalEpoch: verified.claims.pEpoch,
      principalId: verified.claims.pId,
      principalType: verified.claims.pType,
      roomId: verified.claims.room
    });
    return result.status === 'allowed'
      ? { ok: true, claims: verified.claims, strippedPath }
      : { ok: false, code: result.status, strippedPath };
  }

  function createServer() {
    const server = http.createServer((req, res) => {
      if (req.url === '/readyz') {
        store.assertLiveKitGateReady()
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
      res.writeHead(404);
      res.end();
    });

    server.on('upgrade', (request, socket, head) => {
      if (!String(request.url || '').startsWith(path)) {
        deny(socket, 404, 'Not Found');
        return;
      }
      authorize(request.url)
        .then((decision) => {
          if (!decision.ok) {
            deny(socket, 403, 'Forbidden');
            return;
          }
          const upstreamSocket = net.connect({
            host: upstream.hostname,
            port: Number(upstream.port || (upstream.protocol === 'wss:' ? 443 : 80))
          });
          upstreamSocket.once('connect', () => {
            upstreamSocket.write(buildUpstreamUpgradeRequest({ request, strippedPath: decision.strippedPath, upstream }));
            if (head?.length) upstreamSocket.write(head);
            socket.pipe(upstreamSocket);
            upstreamSocket.pipe(socket);
          });
          upstreamSocket.once('error', (error) => {
            logger.error?.('LiveKit gate upstream connection failed:', error);
            deny(socket, 503, 'Service Unavailable');
          });
        })
        .catch((error) => {
          logger.error?.('LiveKit gate authorization failed:', error);
          deny(socket, 503, 'Service Unavailable');
        });
    });
    return server;
  }

  return {
    authorize,
    createServer,
    path,
    upstream
  };
}

module.exports = {
  DEFAULT_GATE_PATH,
  createLiveKitAuthGateService,
  extractCredential
};

if (require.main === module) {
  const logger = console;
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
      logger.info?.(`LiveKit auth gate listening on ${host}:${port}${service.path}`);
    });
  } catch (error) {
    logger.error?.('LiveKit auth gate failed to start:', error);
    process.exitCode = 1;
  }
}
