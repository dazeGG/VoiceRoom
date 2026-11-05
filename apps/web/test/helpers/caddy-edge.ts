// The repository's Caddyfile on the real Caddy image, serving a small web root,
// for tests of what the edge answers. Needs Docker; a test that uses it is
// skipped without.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { onTestFinished } from 'vitest';
import { buildHeaderPolicy, renderCaddySnippet } from '../../scripts/emit-caddy-csp.ts';

const repositoryRoot = `${import.meta.dirname}/../../../../`;
const caddyImage = 'caddy:2.11.4-alpine';

export const dockerAvailable =
  spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
    encoding: 'utf8'
  }).status === 0;

export async function startCaddyEdge({
  env = {},
  files = {},
  binaryFiles = {}
}: {
  env?: Record<string, string>;
  /** Files of the web root by path, next to index.html. */
  files?: Record<string, string>;
  binaryFiles?: Record<string, Uint8Array>;
} = {}): Promise<string> {
  const name = `voiceroom-edge-${randomUUID()}`;
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
  for (const [file, content] of Object.entries({ ...files, ...binaryFiles })) {
    mkdirSync(path.dirname(path.join(webRoot, file)), { recursive: true });
    writeFileSync(path.join(webRoot, file), content);
  }
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
      ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
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
