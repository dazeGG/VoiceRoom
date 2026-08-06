import assert from 'node:assert/strict';
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
