import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CONFIG_CONTRACT,
  parseRuntimeConfig,
  resolveLiveKitConnectUrls
} from '@voice-room/shared/runtime-config';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const caddyImage = 'caddy:2.11.3-alpine';
const dockerAvailable = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
  encoding: 'utf8'
}).status === 0;

function runtimePayload(wsUrl) {
  return JSON.stringify({
    contractVersion: RUNTIME_CONFIG_CONTRACT,
    schemaVersion: 1,
    livekit: { wsUrl, connectFallbacks: [] }
  });
}

async function startEdge(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function fetchEdgeConfig(origin, timeoutMs = 100) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${origin}/runtime-config.json`, { signal: controller.signal });
    if (!response.ok) return DEFAULT_RUNTIME_CONFIG;
    return parseRuntimeConfig(await response.text()) || DEFAULT_RUNTIME_CONFIG;
  } catch {
    return DEFAULT_RUNTIME_CONFIG;
  } finally {
    clearTimeout(timer);
  }
}

async function startCaddyEdge(wsUrl) {
  const name = `voiceroom-g13-${randomUUID()}`;
  const caddyfile = path.join(repositoryRoot, 'Caddyfile');
  const run = spawnSync('docker', [
    'run', '-d', '--name', name,
    '-e', 'DOMAIN=:80',
    '-e', 'LIVEKIT_DOMAIN=:81',
    '-e', `LIVEKIT_GATE_PUBLIC_URL=${wsUrl}`,
    '-p', '127.0.0.1::80',
    '-v', `${caddyfile}:/etc/caddy/Caddyfile:ro`,
    caddyImage
  ], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr || 'failed to start Caddy edge');

  const mapping = spawnSync('docker', ['port', name, '80/tcp'], { encoding: 'utf8' });
  const port = mapping.stdout.trim().match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`missing Caddy port mapping: ${mapping.stderr}`);
  const origin = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${origin}/runtime-config.json`);
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    name,
    origin,
    imageId: spawnSync('docker', ['image', 'inspect', caddyImage, '--format', '{{.Id}}'], { encoding: 'utf8' }).stdout.trim(),
    close: () => { spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' }); }
  };
}

test('G13-A01 the pinned Caddy image serves two runtime configs without rebuilding', {
  skip: !dockerAvailable
}, async (t) => {
  const edgeA = await startCaddyEdge('wss://caddy-a.example.test');
  t.after(edgeA.close);
  const edgeB = await startCaddyEdge('wss://caddy-b.example.test');
  t.after(edgeB.close);

  const first = await fetchEdgeConfig(edgeA.origin, 1_000);
  const second = await fetchEdgeConfig(edgeB.origin, 1_000);
  assert.equal(first.livekit.wsUrl, 'wss://caddy-a.example.test/');
  assert.equal(second.livekit.wsUrl, 'wss://caddy-b.example.test/');
  assert.match(edgeA.imageId, /^sha256:/);
  assert.equal(edgeA.imageId, edgeB.imageId);
});

test('G13-A01 one Web image contract serves distinct runtime configuration over real HTTP edges', async (t) => {
  const edgeA = await startEdge((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(runtimePayload('wss://livekit-a.example.test'));
  });
  const edgeB = await startEdge((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(runtimePayload('wss://livekit-b.example.test'));
  });
  t.after(() => Promise.all([edgeA.close(), edgeB.close()]));

  const first = await fetchEdgeConfig(edgeA.origin);
  const second = await fetchEdgeConfig(edgeB.origin);
  assert.equal(first.livekit.wsUrl, 'wss://livekit-a.example.test/');
  assert.equal(second.livekit.wsUrl, 'wss://livekit-b.example.test/');
  assert.deepEqual(resolveLiveKitConnectUrls(first, ''), ['wss://livekit-a.example.test/']);
  assert.deepEqual(resolveLiveKitConnectUrls(second, ''), ['wss://livekit-b.example.test/']);

  const dockerfile = readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');
  const caddyfile = readFileSync(path.join(repositoryRoot, 'Caddyfile'), 'utf8');
  assert.match(dockerfile, /FROM caddy:2\.11\.3-alpine AS web/);
  assert.match(caddyfile, /handle \/runtime-config\.json/);
  assert.match(caddyfile, /Cache-Control "no-store"/);
  assert.match(caddyfile, /\{\$LIVEKIT_GATE_PUBLIC_URL\}/);
});

test('G13-A02 404, timeout, malformed, wrong-version and credential payloads fail safely', async (t) => {
  const cases = [
    (_request, response) => { response.writeHead(404); response.end(); },
    (_request, _response) => {},
    (_request, response) => { response.end('{bad json'); },
    (_request, response) => { response.end(JSON.stringify({ contractVersion: RUNTIME_CONFIG_CONTRACT, schemaVersion: 2, livekit: { wsUrl: 'wss://wrong.example.test' } })); },
    (_request, response) => { response.end(runtimePayload('wss://user:secret@livekit.example.test')); }
  ];

  for (const handler of cases) {
    const edge = await startEdge(handler);
    t.after(edge.close);
    const config = await fetchEdgeConfig(edge.origin, 25);
    assert.deepEqual(config, DEFAULT_RUNTIME_CONFIG);
  }

  const caddyfile = readFileSync(path.join(repositoryRoot, 'Caddyfile'), 'utf8');
  const dockerfile = readFileSync(path.join(repositoryRoot, 'Dockerfile'), 'utf8');
  assert.doesNotMatch(`${caddyfile}\n${dockerfile}`, /(password|api[_-]?key|private[_-]?key)\s*[:=]/i);
});
