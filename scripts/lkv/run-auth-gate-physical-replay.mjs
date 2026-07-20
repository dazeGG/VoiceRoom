#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const { AccessToken, TrackSource } = require('livekit-server-sdk');
const { createGateCredentialSigner } = require('../../apps/api/src/domains/admission/gate-credential-signer.js');
const { createDbPool } = require('../../apps/api/src/lib/db.js');
const { runMigrations } = require('../../apps/api/src/lib/migrate.js');
const { createRoomStore } = require('../../apps/api/src/lib/room-store.js');

const EXPECTED_NODE_VERSION = 'v24.18.0';
const ROOM_ID = 'room-g05-physical';
const LIVEKIT_ROOM = `voice-room-${ROOM_ID}`;
const PEER_ID = 'peer-g05-physical';
const PRINCIPAL = { principalType: 'guest', principalId: `${ROOM_ID}:guest-g05-physical` };
const GATE_SECRET = process.env.LIVEKIT_GATE_SECRET || 'dev-g05-livekit-gate-secret-32-bytes-minimum';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://voice_room:voice_room@postgres:5432/voice_room';
const LIVEKIT_INTERNAL_URL = process.env.LIVEKIT_INTERNAL_URL || 'ws://livekit:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'devsecret';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(label, operation, { attempts = 60, delayMs = 1000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      await sleep(delayMs);
    }
  }
  throw new Error(`${label} did not become ready: ${lastError?.message || lastError}`);
}

async function waitForPostgres(pool) {
  return retry('postgres', async () => {
    await pool.query('SELECT 1');
    return true;
  });
}

async function waitForGateReady(port, expectedStatus = 200) {
  return retry(`gate:${port}`, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`);
    if (response.status !== expectedStatus) {
      throw new Error(`readyz returned ${response.status}, expected ${expectedStatus}`);
    }
    return response.status;
  });
}

function startGate({ databaseUrl, port }) {
  const child = spawn(process.execPath, ['apps/api/src/domains/admission/livekit-auth-gate-service.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      LIVEKIT_GATE_HOST: '127.0.0.1',
      LIVEKIT_GATE_PORT: String(port),
      LIVEKIT_GATE_SECRET: GATE_SECRET,
      LIVEKIT_INTERNAL_URL
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk).trim()));
  child.stderr.on('data', (chunk) => logs.push(String(chunk).trim()));
  return {
    child,
    logs,
    async stop() {
      if (child.exitCode !== null || child.killed) return;
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        sleep(3000).then(() => {
          if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
        })
      ]);
    }
  };
}

async function seedRoom(pool) {
  await pool.query(
    `INSERT INTO rooms (id, creator_ip, is_static, created_at, updated_at, metadata)
     VALUES ($1, '127.0.0.1', true, current_timestamp, current_timestamp, '{}'::jsonb)
     ON CONFLICT (id) DO UPDATE
       SET updated_at = EXCLUDED.updated_at,
           deleted_at = NULL`,
    [ROOM_ID]
  );
}

async function mintCredentials({ pool }) {
  const store = createRoomStore({ pool, logger: console });
  const signer = createGateCredentialSigner({ secret: GATE_SECRET });
  const epoch = await store.getLiveKitGatePrincipalEpoch({ principal: PRINCIPAL, roomId: ROOM_ID });
  if (epoch.status !== 'ready') throw new Error(`unexpected epoch status ${epoch.status}`);

  const livekit = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: PEER_ID,
    metadata: JSON.stringify({ roomId: ROOM_ID }),
    name: 'G05 physical replay',
    ttl: 600
  });
  livekit.addGrant({
    canPublish: true,
    canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
    room: LIVEKIT_ROOM,
    roomJoin: true
  });
  const livekitJwt = await livekit.toJwt();
  const expiresAt = Date.now() + 600_000;
  const gateCredential = signer.sign({
    expiresAt,
    peerId: PEER_ID,
    principalEpoch: epoch.epoch,
    principalId: PRINCIPAL.principalId,
    principalType: PRINCIPAL.principalType,
    roomId: ROOM_ID
  });
  const stored = await store.createLiveKitGateCredential({
    credentialHash: signer.hash(gateCredential),
    expiresAt,
    peerId: PEER_ID,
    principal: PRINCIPAL,
    principalEpoch: epoch.epoch,
    roomId: ROOM_ID
  });
  if (stored.status !== 'created') throw new Error(`gate credential store returned ${stored.status}`);
  return {
    gateCredential,
    livekitJwt,
    store,
    url(port) {
      const url = new URL(`ws://127.0.0.1:${port}/rtc`);
      url.searchParams.set('access_token', livekitJwt);
      url.searchParams.set('vr_gate_credential', gateCredential);
      return url.toString();
    }
  };
}

function openWebSocket(url, { timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const ws = new WebSocket(url);
    let opened = false;
    let settled = false;
    let errorMessage = '';
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      resolve({ elapsedMs: Date.now() - startedAt, error: 'timeout', outcome: 'timeout' });
    }, timeoutMs);
    ws.addEventListener('open', () => {
      opened = true;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      resolve({ elapsedMs: Date.now() - startedAt, outcome: 'opened' });
    });
    ws.addEventListener('error', (event) => {
      errorMessage = event?.error?.message || event?.message || 'websocket error';
    });
    ws.addEventListener('close', (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        closeCode: event.code,
        closeReason: event.reason,
        elapsedMs: Date.now() - startedAt,
        error: errorMessage,
        outcome: opened ? 'closed_after_open' : 'rejected'
      });
    });
  });
}

function assertCase(condition, id, detail) {
  return { detail, id, passed: Boolean(condition) };
}

async function directLocalhostPortClosed(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ closed: false, outcome: 'timeout' });
    }, 1000);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ closed: false, outcome: 'connected' });
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      resolve({ closed: true, error: error.code || error.message, outcome: 'rejected' });
    });
  });
}

export async function runPhysicalReplay() {
  const evidence = {
    cases: [],
    goal: 'G05',
    nodeVersion: process.version,
    schemaVersion: 1,
    selectedMechanism: 'external-auth-gate',
    topology: {
      databaseUrl: DATABASE_URL.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:<redacted>@'),
      gateEntrypoint: 'apps/api/src/domains/admission/livekit-auth-gate-service.js',
      livekitImage: 'livekit/livekit-server:v1.13.2',
      livekitInternalUrl: LIVEKIT_INTERNAL_URL
    }
  };
  if (process.version !== EXPECTED_NODE_VERSION) {
    evidence.status = 'PHYSICAL_REPLAY_BLOCKED';
    evidence.blocker = `expected Node ${EXPECTED_NODE_VERSION}, got ${process.version}`;
    evidence.successorStartAllowed = false;
    evidence.greenF11Allowed = false;
    return evidence;
  }

  const pool = createDbPool({ databaseUrl: DATABASE_URL, logger: console });
  const gates = [];
  try {
    await waitForPostgres(pool);
    const migrations = await runMigrations({ databaseUrl: DATABASE_URL, logger: console });
    evidence.migrationsApplied = migrations.map((migration) => migration.name);
    await seedRoom(pool);
    const credential = await mintCredentials({ pool });

    const direct7880 = await directLocalhostPortClosed(7880);
    evidence.cases.push(assertCase(direct7880.closed, 'G05-A02-direct-7880-public-bypass-absent', direct7880));

    const firstGate = startGate({ databaseUrl: DATABASE_URL, port: 3090 });
    gates.push(firstGate);
    await waitForGateReady(3090, 200);
    const exactUrl = credential.url(3090);
    const firstConnect = await openWebSocket(exactUrl);
    evidence.cases.push(assertCase(firstConnect.outcome === 'opened', 'G05-A01-initial-gate-upgrade-reaches-livekit', firstConnect));

    const revoked = await credential.store.revokeLiveKitGatePrincipal({ principal: PRINCIPAL, roomId: ROOM_ID });
    evidence.revocation = revoked;
    const afterRevoke = await openWebSocket(exactUrl);
    evidence.cases.push(assertCase(afterRevoke.outcome === 'rejected', 'G05-A01-same-url-jwt-denied-after-postgres-epoch-revoke', afterRevoke));

    await firstGate.stop();
    const restartedGate = startGate({ databaseUrl: DATABASE_URL, port: 3090 });
    gates.push(restartedGate);
    await waitForGateReady(3090, 200);
    const afterRestart = await openWebSocket(exactUrl);
    evidence.cases.push(assertCase(afterRestart.outcome === 'rejected', 'G05-A03-gate-restart-still-denies-same-url-jwt', afterRestart));

    const outageGate = startGate({
      databaseUrl: 'postgres://voice_room:voice_room@127.0.0.1:65534/voice_room',
      port: 3091
    });
    gates.push(outageGate);
    await waitForGateReady(3091, 503);
    const outageDenied = await openWebSocket(credential.url(3091));
    evidence.cases.push(assertCase(outageDenied.outcome === 'rejected', 'G05-A03-db-outage-fails-closed', outageDenied));

    evidence.gateLogs = gates.map((gate, index) => ({
      index,
      lines: gate.logs.filter(Boolean).slice(-8)
    }));
    evidence.status = evidence.cases.every((entry) => entry.passed) ? 'PHYSICAL_REPLAY_PROVEN' : 'PHYSICAL_REPLAY_FAILED';
    evidence.successorStartAllowed = evidence.status === 'PHYSICAL_REPLAY_PROVEN';
    evidence.greenF11Allowed = evidence.status === 'PHYSICAL_REPLAY_PROVEN';
    return evidence;
  } finally {
    await Promise.all(gates.map((gate) => gate.stop()));
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      json: { type: 'boolean', default: false },
      'fail-on-blocked': { type: 'boolean', default: false }
    }
  });
  const report = await runPhysicalReplay();
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : `${JSON.stringify(report)}\n`);
  if (values['fail-on-blocked'] && report.status !== 'PHYSICAL_REPLAY_PROVEN') process.exitCode = 2;
}
