import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pageCspDirectives } from '../scripts/deploy-contract.ts';
import { buildHeaderPolicy, readMetaPolicy, renderCaddySnippet } from '../scripts/emit-caddy-csp.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const readRepo = (path: string) => readFileSync(join(repoRoot, path), 'utf8');

const META =
  "default-src 'self'; connect-src 'self' http: https: ws: wss: stun:; img-src 'self' data: blob:; object-src 'none'; script-src 'self' 'wasm-unsafe-eval'; base-uri 'none'; form-action 'none'";

test('the header keeps every meta directive', () => {
  const policy = buildHeaderPolicy(META);
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval'/);
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

test('a policy that would block the app or allow inline script fails instead of shipping', () => {
  assert.throws(() => buildHeaderPolicy("default-src 'self'; script-src 'wasm-unsafe-eval'"), /does not allow 'self'/);
  assert.throws(() => buildHeaderPolicy("default-src 'self'"), /does not allow 'self'/);
  assert.throws(() => buildHeaderPolicy("script-src 'self' 'unsafe-inline'"), /'unsafe-inline'/);
});

test('the page must carry the policy and no inline script', () => {
  const meta = `<meta http-equiv="content-security-policy" content="${META}">`;
  const bundle = '/_app/immutable/index.js';
  assert.equal(readMetaPolicy(`<head>${meta}<script type="module" crossorigin src="${bundle}"></script>`), META);
  assert.throws(() => readMetaPolicy('<html></html>'), /no content-security-policy/);
  assert.equal(readMetaPolicy(`<head>${meta}<script type="module" src = "${bundle}"></script>`), META);
  assert.equal(readMetaPolicy(`<head>${meta}<script src\n=\n"${bundle}" type="module"></script>`), META);
  assert.throws(() => readMetaPolicy(`<head>${meta}<script>boot()</script></head>`), /inline <script>/);
  assert.throws(() => readMetaPolicy(`<head>${meta}<script type="module">boot()</script></head>`), /inline <script>/);
});

test('the snippet is one quoted Caddy header line', () => {
  const snippet = renderCaddySnippet(buildHeaderPolicy(META));
  assert.match(snippet, /^# Generated/);
  assert.match(snippet, /\nContent-Security-Policy "[^"\n]+"\n$/);
  assert.throws(() => renderCaddySnippet('a "b"'), /double quote/);
});

test('Caddy imports the generated policy and the image builds it', () => {
  const caddyfile = readRepo('Caddyfile');
  const dockerfile = readRepo('Dockerfile');
  assert.match(caddyfile, /import \/etc\/caddy\/csp\.caddy/);
  assert.doesNotMatch(caddyfile, /Content-Security-Policy "/);
  assert.match(dockerfile, /emit-caddy-csp\.ts apps\/web\/dist\/index\.html > \/app\/csp\.caddy/);
  assert.match(dockerfile, /COPY --from=web-build \/app\/csp\.caddy \/etc\/caddy\/csp\.caddy/);
});

test('page CSP supports runtime LiveKit origins while production Caddy narrows them', () => {
  const directives = pageCspDirectives({});
  const connect = directives['connect-src'] ?? [];
  for (const source of ['self', 'http:', 'https:', 'ws:', 'wss:', 'ws://localhost:*', 'ws://127.0.0.1:*']) {
    assert.ok(connect.includes(source), `missing runtime connect source ${source}`);
  }
  assert.deepEqual(directives['style-src'], ['self', 'unsafe-inline']);
  assert.deepEqual(directives['script-src'], ['self', 'wasm-unsafe-eval']);
});

test('a build that knows its LiveKit origin adds it to the page connect-src', () => {
  const directives = pageCspDirectives({
    LIVEKIT_URL: 'wss://lk.example.com/rtc',
    LIVEKIT_PUBLIC_URL: 'not a url',
    LIVEKIT_DOMAIN: 'media.example.com',
    DOMAIN: 'example.org'
  });
  const connect = directives['connect-src'] ?? [];
  for (const origin of ['wss://lk.example.com', 'wss://media.example.com', 'wss://livekit.example.org']) {
    assert.ok(connect.includes(origin), `missing ${origin}`);
  }
  assert.ok(!connect.includes('not a url'));
});
