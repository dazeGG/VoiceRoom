import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHeaderPolicy, readMetaPolicy, renderCaddySnippet } from '../scripts/emit-caddy-csp.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const META = "default-src 'self'; connect-src 'self' http: https: ws: wss: stun:; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-abc123='; base-uri 'none'; form-action 'none'";

test('the header keeps the build hash and every meta directive', () => {
  const policy = buildHeaderPolicy(META);
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval' 'sha256-abc123='/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'none'/);
  assert.match(policy, /form-action 'none'/);
  assert.match(policy, /default-src 'self'/);
});

test('the header narrows connect-src to the deployment LiveKit origin and forbids framing', () => {
  const policy = buildHeaderPolicy(META);
  assert.match(policy, /connect-src 'self' wss:\/\/\{\$LIVEKIT_DOMAIN\} https:\/\/\{\$LIVEKIT_DOMAIN\} stun: turn: turns:/);
  assert.doesNotMatch(policy, /connect-src[^;]*\bhttp:/);
  assert.match(policy, /frame-ancestors 'none'/);
});

test('a build without a bootstrap hash or meta tag fails instead of shipping a policy that blocks the app', () => {
  assert.throws(() => buildHeaderPolicy("default-src 'self'; script-src 'self'"), /bootstrap hash/);
  assert.throws(() => readMetaPolicy('<html></html>'), /no content-security-policy/);
});

test('the snippet is one quoted Caddy header line', () => {
  const snippet = renderCaddySnippet(buildHeaderPolicy(META));
  assert.match(snippet, /^# Generated/);
  assert.match(snippet, /\nContent-Security-Policy "[^"\n]+"\n$/);
  assert.throws(() => renderCaddySnippet('a "b"'), /double quote/);
});

test('Caddy imports the generated policy and the image builds it', () => {
  const caddyfile = readFileSync(join(repoRoot, 'Caddyfile'), 'utf8');
  const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8');
  assert.match(caddyfile, /import \/etc\/caddy\/csp\.caddy/);
  assert.doesNotMatch(caddyfile, /Content-Security-Policy "/);
  assert.match(dockerfile, /emit-caddy-csp\.mjs apps\/web\/dist\/index\.html > \/app\/csp\.caddy/);
  assert.match(dockerfile, /COPY --from=web-build \/app\/csp\.caddy \/etc\/caddy\/csp\.caddy/);
});
