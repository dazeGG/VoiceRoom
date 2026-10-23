import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, onTestFinished } from 'vitest';
import { buildHeaderPolicy, renderCaddySnippet } from '../scripts/emit-caddy-csp.ts';

const repositoryRoot = `${import.meta.dirname}/../../../`;
const caddyImage = 'caddy:2.11.4-alpine';
const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8'
  }).status === 0;

// The React Native debug keystore's fingerprint, the one the dev stand publishes.
const fingerprint = 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';

async function startCaddyEdge(certSha256: string) {
  const name = `voiceroom-assetlinks-${randomUUID()}`;
  // The image generates this snippet from its own build; any valid policy
  // lets the Caddyfile load here.
  const cspSnippet = path.join(mkdtempSync(path.join(os.tmpdir(), 'voiceroom-csp-')), 'csp.caddy');
  writeFileSync(
    cspSnippet,
    renderCaddySnippet(buildHeaderPolicy("default-src 'self'; script-src 'self' 'sha256-test='"))
  );
  // A web page for the SPA fallback, so an unhandled path would answer 200.
  const webRoot = mkdtempSync(path.join(os.tmpdir(), 'voiceroom-web-'));
  writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><html><body>web</body></html>');
  const run = spawnSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      name,
      '-e',
      'DOMAIN=:80',
      '-e',
      'LIVEKIT_DOMAIN=:81',
      '-e',
      'ADMIN_DOMAIN=:82',
      '-e',
      'LIVEKIT_GATE_PUBLIC_URL=wss://livekit.example.test',
      '-e',
      `ANDROID_RELEASE_CERT_SHA256=${certSha256}`,
      '-p',
      '127.0.0.1::80',
      '-v',
      `${path.join(repositoryRoot, 'Caddyfile')}:/etc/caddy/Caddyfile:ro`,
      '-v',
      `${cspSnippet}:/etc/caddy/csp.caddy:ro`,
      '-v',
      `${webRoot}:/srv/web:ro`,
      '-v',
      `${path.join(repositoryRoot, 'config/caddy/admin-csp.caddy')}:/etc/caddy/admin-csp.caddy:ro`,
      caddyImage
    ],
    { encoding: 'utf8' }
  );
  if (run.status !== 0) throw new Error(run.stderr || 'failed to start Caddy edge');
  const close = () => {
    spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8' });
  };
  onTestFinished(close);

  const mapping = spawnSync('docker', ['port', name, '80/tcp'], { encoding: 'utf8' });
  const port = mapping.stdout.trim().match(/:(\d+)$/)?.[1];
  if (!port) throw new Error(`missing Caddy port mapping: ${mapping.stderr}`);
  const origin = `http://127.0.0.1:${port}`;

  let lastError: unknown = new Error('Caddy did not answer');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`${origin}/runtime-config.json`)).ok) return origin;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const logs = spawnSync('docker', ['logs', name], { encoding: 'utf8' });
  throw new Error(`Caddy edge did not become ready: ${logs.stderr}`, { cause: lastError });
}

test(
  'AC16 a well-formed fingerprint publishes the App Links statement for voiceroom.app',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge(fingerprint);
    const response = await fetch(`${origin}/.well-known/assetlinks.json`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.deepEqual(await response.json(), [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'voiceroom.app',
          sha256_cert_fingerprints: [fingerprint]
        }
      }
    ]);
  }
);

test(
  'AC16 an empty or malformed fingerprint answers 404, never the web page',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    for (const value of ['', 'ab:cd']) {
      const origin = await startCaddyEdge(value);
      const response = await fetch(`${origin}/.well-known/assetlinks.json`);
      const body = await response.text();
      assert.equal(response.status, 404, `value ${JSON.stringify(value)}`);
      assert.doesNotMatch(body, /<html/i);
    }
  }
);
