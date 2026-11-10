import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { test } from 'vitest';
import { dockerAvailable, startCaddyEdge } from './helpers/caddy-edge.ts';

const repoRoot = `${import.meta.dirname}/../../../`;
const read = (relative: string) => readFileSync(`${repoRoot}${relative}`, 'utf8');

test(
  'the edge starts with an empty extra-sites directory and serves the normal site',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge();
    const response = await fetch(`${origin}/`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /web/);
  }
);

test(
  'a host-managed site file is served by Host while the normal site still answers',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge({
      sites: { 'extra.caddy': 'http://extra.test {\n  respond "extra" 200\n}\n' }
    });
    const url = new URL(origin);
    // fetch forbids overriding Host, so ask over a raw socket.
    const extra = await new Promise<string>((resolve, reject) => {
      request({ host: url.hostname, port: url.port, path: '/', headers: { Host: 'extra.test' } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve(body));
      })
        .on('error', reject)
        .end();
    });
    assert.equal(extra, 'extra');
    const main = await fetch(`${origin}/`);
    assert.match(await main.text(), /web/);
  }
);

test('compose mounts the extra-sites directory read-only and the entrypoint never touches it', () => {
  assert.match(read('docker-compose.yml'), /- \.\/config\/caddy\/sites\.d:\/etc\/caddy\/sites\.d:ro\n/);
  assert.doesNotMatch(read('config/caddy/entrypoint.sh'), /sites\.d/);
});
