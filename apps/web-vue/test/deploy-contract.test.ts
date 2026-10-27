import { onTestFinished, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { build } from 'vite';

import { metaPolicy, pageCspDirectives, versionFile } from '../scripts/deploy-contract.ts';
import { buildHeaderPolicy, readMetaPolicy } from '../scripts/emit-caddy-csp.ts';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the meta policy quotes keywords, not schemes, and leaves out what a meta tag ignores', () => {
  const policy = metaPolicy({
    'default-src': ['self'],
    'connect-src': ['self', 'wss:', 'wss://lk.example.com'],
    'frame-ancestors': ['none'],
    'script-src': ['self', 'wasm-unsafe-eval'],
    'img-src': []
  });
  assert.equal(
    policy,
    "default-src 'self'; connect-src 'self' wss: wss://lk.example.com; script-src 'self' 'wasm-unsafe-eval'"
  );
});

test('version.json has the shape SvelteKit writes, so open tabs of either build can read it', () => {
  assert.deepEqual(JSON.parse(versionFile('1793024058890')), { version: '1793024058890' });
});

const SvelteConfigModule = Type.Object({
  default: Type.Object({
    kit: Type.Object({
      csp: Type.Object({ directives: Type.Record(Type.String(), Type.Array(Type.String())) })
    })
  })
});

/** The CSP directives of the Svelte web's config, each proved to be a list of strings. */
async function svelteCspDirectives(): Promise<Record<string, string[]>> {
  // A variable specifier keeps TypeScript from asking for declarations of the plain JS config.
  const specifier = join(webRoot, '..', 'web', 'svelte.config.js');
  const config: unknown = await import(/* @vite-ignore */ specifier);
  assert.ok(Value.Check(SvelteConfigModule, config), 'apps/web/svelte.config.js has no kit.csp.directives');
  return config.default.kit.csp.directives;
}

// Delete this test at the cutover, when apps/web-vue becomes apps/web and there is no svelte.config.js to drift from.
test('the page policy equals the one in apps/web/svelte.config.js, with and without LiveKit env', async () => {
  const empty = { LIVEKIT_URL: '', LIVEKIT_PUBLIC_URL: '', LIVEKIT_DOMAIN: '', DOMAIN: '' };
  const configured = {
    LIVEKIT_URL: 'wss://lk.example.com/rtc',
    LIVEKIT_PUBLIC_URL: 'not a url',
    LIVEKIT_DOMAIN: 'media.example.com',
    DOMAIN: 'example.com'
  };
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  for (const env of [empty, configured]) {
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    // svelte.config.js reads process.env when it loads.
    vi.resetModules();
    assert.deepEqual(pageCspDirectives(env), await svelteCspDirectives());
  }
});

test('a production build keeps the deployment contract', { timeout: 60_000 }, async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'web-vue-build-'));
  // `$&` and `$'` are replacement patterns in String.replace; they must reach the page as written.
  const livekitDomain = "lk$&x$'y.example.com";
  vi.stubEnv('LIVEKIT_DOMAIN', livekitDomain);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  try {
    await build({ root: webRoot, logLevel: 'silent', build: { outDir, emptyOutDir: true } });

    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    assert.ok(readMetaPolicy(html).includes(`wss://${livekitDomain}`));
    const policy = buildHeaderPolicy(readMetaPolicy(html));
    assert.match(policy, /script-src 'self' 'wasm-unsafe-eval'/);
    // The policy governs only what follows it.
    const meta = html.indexOf('http-equiv="content-security-policy"');
    assert.ok(meta !== -1);
    assert.ok(meta < html.indexOf('<script'), 'the CSP meta must come before the first <script');
    const preload = html.search(/<link\s+rel="modulepreload"/);
    if (preload !== -1) assert.ok(meta < preload, 'the CSP meta must come before the modulepreload links');
    assert.match(html, /<script type="module" crossorigin src="\/_app\/immutable\/[^"]+\.js"><\/script>/);

    const version: unknown = JSON.parse(readFileSync(join(outDir, '_app', 'version.json'), 'utf8'));
    assert.ok(typeof version === 'object' && version !== null && 'version' in version);
    assert.match(String(version.version), /^\d+$/);

    const immutable = readdirSync(join(outDir, '_app', 'immutable'));
    assert.ok(immutable.some((file) => file.endsWith('.js')));
    // public/ is served from the root, next to index.html.
    assert.ok(readdirSync(outDir).includes('voiceroom-icon.svg'));
    assert.ok(readdirSync(join(outDir, 'rnnoise')).includes('rnnoise.wasm'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
