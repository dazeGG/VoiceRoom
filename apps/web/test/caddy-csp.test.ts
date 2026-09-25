import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildHeaderPolicy, readMetaPolicy, renderCaddySnippet } from '../scripts/emit-caddy-csp.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readRepo = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const readWeb = (path: string) => readFileSync(join(repoRoot, 'apps', 'web', path), 'utf8');
const META =
  "default-src 'self'; connect-src 'self' http: https: ws: wss: stun:; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'wasm-unsafe-eval' 'sha256-abc123='; base-uri 'none'; form-action 'none'";

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
  assert.match(
    policy,
    /connect-src 'self' wss:\/\/\{\$LIVEKIT_DOMAIN\} https:\/\/\{\$LIVEKIT_DOMAIN\} stun: turn: turns:/
  );
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
  assert.match(dockerfile, /emit-caddy-csp\.ts apps\/web\/dist\/index\.html > \/app\/csp\.caddy/);
  assert.match(dockerfile, /COPY --from=web-build \/app\/csp\.caddy \/etc\/caddy\/csp\.caddy/);
});

test('page CSP supports runtime LiveKit origins while production Caddy narrows them', () => {
  const config = readWeb('svelte.config.js');
  const caddy = readRepo('Caddyfile');
  const compose = readRepo('docker-compose.yml');
  const dockerfile = readRepo('Dockerfile');
  const cspBlock = config.slice(config.indexOf("'connect-src'"), config.indexOf("'default-src'"));

  assert.match(config, /function liveKitConnectSources/);
  assert.ok(cspBlock.includes('...liveKitConnectSources()'));
  for (const scheme of ["'http:'", "'https:'", "'ws:'", "'wss:'"]) {
    assert.ok(cspBlock.includes(scheme), `missing runtime connect scheme ${scheme}`);
  }
  assert.ok(cspBlock.includes("'ws://localhost:*'"));
  assert.ok(cspBlock.includes("'ws://127.0.0.1:*'"));
  // Caddy imports the full policy generated from this build (see
  // test/caddy-csp.test.ts), which narrows connect-src to LIVEKIT_DOMAIN.
  assert.match(caddy, /import \/etc\/caddy\/csp\.caddy/);
  assert.match(dockerfile, /FROM caddy:2\.11\.4-alpine AS web/);
  assert.match(
    compose,
    /\n {2}caddy:\n[\s\S]*?image: \$\{VOICEROOM_WEB_IMAGE:\?set immutable VOICEROOM_WEB_IMAGE digest\}/
  );
  assert.ok(config.includes("'style-src': ['self', 'unsafe-inline']"));
  assert.match(config, /style attributes/);
});
