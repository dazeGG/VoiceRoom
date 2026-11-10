// Opt-in runtime check against the pinned Caddy image, not a source-text assertion.
// CADDY_TEST_IMAGE=caddy:2.11.4-alpine node --test scripts/test/caddy-log-redaction.test.mts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const image = process.env.CADDY_TEST_IMAGE;

test('Caddy proxy and upgrade errors retain diagnostics without request secrets', { skip: !image }, async (t) => {
  if (!image) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceroom-caddy-logs-'));
  const name = `vr-log-test-${randomUUID()}`;
  const docker = (...args: string[]) => {
    const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result.stdout;
  };
  t.after(() => {
    spawnSync('docker', ['rm', '-f', name], { encoding: 'utf8', timeout: 30_000 });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const config = fs.readFileSync(new URL('../../Caddyfile', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const end = config.indexOf('\n}\n');
  assert.ok(end > 0, 'the production Caddyfile has a global options block');
  // Exercise its actual runtime logger without requiring the TURN module/sites.
  const global = config.slice(0, end + 2).replace(/^\s*import .+$/gm, '');
  fs.writeFileSync(path.join(root, 'Caddyfile'), `${global}\n:80 {\n reverse_proxy 127.0.0.1:1\n}\n`);
  docker('run', '-d', '--name', name, '-p', '127.0.0.1::80', '-v', `${root}:/etc/caddy:ro`, image);
  const address = docker('port', name, '80/tcp').trim();
  const secrets = [
    'secret-room-path',
    'secret-livekit-token',
    'secret-gate-credential',
    'secret-cookie',
    'secret-auth',
    'secret-referrer'
  ];
  const url = `http://${address}/${secrets[0]}?access_token=${secrets[1]}&vr_gate_credential=${secrets[2]}`;
  const headers = {
    Cookie: `session=${secrets[3]}`,
    Authorization: `Bearer ${secrets[4]}`,
    Referer: `https://example.invalid/${secrets[5]}`
  };
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 502);
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(ready, 'the proxy must actually answer the failing request');
  // Node's HTTP client, unlike fetch, permits a WebSocket upgrade request.
  const { request } = await import('node:http');
  await new Promise<void>((resolve, reject) => {
    const req = request(url, { headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket' } }, (res) => {
      try {
        assert.equal(res.statusCode, 502);
        res.resume();
        res.once('end', resolve);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.setTimeout(3000, () => req.destroy(new Error('upgrade request timed out')));
    req.once('error', reject);
    req.end();
  });
  const captured = spawnSync('docker', ['logs', name], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(captured.status, 0);
  const logs = captured.stdout + captured.stderr;
  for (const secret of secrets) assert.ok(!logs.includes(secret), `must not log ${secret}`);
  assert.match(logs, /"status":502/);
  assert.match(logs, /connection refused/);
  assert.match(logs, /"err_id":/);
});
