import { onTestFinished, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

import { metaPolicy, versionFile } from '../scripts/deploy-contract.ts';
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

test('a production build keeps the deployment contract', { timeout: 60_000 }, async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'web-build-'));
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
    // The update check compares the file against the id compiled into the bundle.
    const bundle = immutable
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(join(outDir, '_app', 'immutable', file), 'utf8'))
      .join('\n');
    assert.ok(bundle.includes(String(version.version)), 'the bundle carries the build id of version.json');

    // Web push: one self-contained module at the root, as SvelteKit emitted it.
    const serviceWorker = readFileSync(join(outDir, 'service-worker.js'), 'utf8');
    assert.ok(serviceWorker.includes('showNotification'));
    assert.doesNotMatch(serviceWorker, /(^|[;}])\s*import[\s{*]/m);
    // public/ is served from the root, next to index.html.
    assert.ok(readdirSync(outDir).includes('voiceroom-icon.svg'));
    assert.ok(readdirSync(join(outDir, 'rnnoise')).includes('rnnoise.wasm'));
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
