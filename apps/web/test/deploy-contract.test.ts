import { onTestFinished, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer as createHttpServer, get, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';
import { build, createServer } from 'vite';
import { voiceAssetUrls } from '@voice-room/call/voice-assets';

import { metaPolicy, versionFile, voiceAssetDirectory, voiceAssetVersion } from '../scripts/deploy-contract.ts';
import { buildHeaderPolicy, readMetaPolicy } from '../scripts/emit-caddy-csp.ts';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const widgetRoot = join(webRoot, '..', 'widget');
const mediaPaths = [
  '/audio-gate.worklet.js',
  '/desktop-audio-source.worklet.js',
  '/rnnoise/rnnoise.mjs',
  '/rnnoise/rnnoise.wasm',
  '/rnnoise/rnnoise.worklet.js'
];

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

test('generated RNNoise worklet is reproducible and changes the cache-busting voice asset version', () => {
  execFileSync(process.execPath, [join(webRoot, 'scripts/build-rnnoise-worklet.ts'), '--check']);
  const publicDir = mkdtempSync(join(tmpdir(), 'voice-assets-'));
  try {
    mkdirSync(join(publicDir, 'rnnoise'));
    for (const path of mediaPaths) {
      copyFileSync(join(voiceAssetDirectory, path), join(publicDir, path));
    }
    const newVersion = voiceAssetVersion(publicDir);
    copyFileSync(
      join(webRoot, 'test/fixtures/rnnoise-old.worklet.js.txt'),
      join(publicDir, 'rnnoise/rnnoise.worklet.js')
    );
    const oldVersion = voiceAssetVersion(publicDir);
    assert.notEqual(newVersion, oldVersion);
    assert.equal(newVersion, voiceAssetVersion());
  } finally {
    rmSync(publicDir, { recursive: true, force: true });
  }
});

// Replacement patterns in String.replace must reach the page as written.
const livekitDomain = "lk$&x$'y.example.com";
const deployContractMode = process.env.WEB_DEPLOY_CONTRACT;

function verifyDeployArtifacts(outDir: string) {
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

  // Fonts are named by content, so the year-long cache of that directory holds for them.
  assert.ok(
    immutable.some((file) => /^onest-cyrillic-.+.woff2$/.test(file)),
    'a hashed font'
  );
  assert.ok(!readdirSync(outDir).includes('fonts'), 'no font under a fixed name');
  // The audio files keep fixed names; their addresses carry a content hash.
  const audioVersion = voiceAssetVersion();
  assert.ok(bundle.includes(`?v=${audioVersion}`), 'the bundle carries the audio files version');
  assert.equal(voiceAssetVersion(outDir), audioVersion, 'the query names the exact deployed bytes');
  assert.deepEqual(
    Object.values(voiceAssetUrls(audioVersion)),
    mediaPaths.map((path) => `${path}?v=${audioVersion}`)
  );
  for (const url of Object.values(voiceAssetUrls(audioVersion))) {
    assert.ok(bundle.includes(url), `the browser receives ${url}`);
  }
  assert.deepEqual(
    readFileSync(join(outDir, 'rnnoise', 'LICENSE')),
    readFileSync(join(voiceAssetDirectory, 'rnnoise', 'LICENSE'))
  );

  // The page has something to show before its code arrives, and the app mounts over it.
  assert.match(html, /<div id="app"><div class="boot-splash"/);
  // The largest files come compressed ahead, at a strength too slow for each request.
  const entryUrl = html.match(/<script type="module" crossorigin src="(\/_app\/immutable\/[^"]+\.js)"><\/script>/)?.[1];
  assert.ok(entryUrl, 'the page declares its actual immutable module entry');
  const entry = basename(entryUrl);
  assert.ok(entry && immutable.includes(`${entry}.br`) && immutable.includes(`${entry}.gz`), 'a compressed entry');
  const entryPath = join(outDir, '_app', 'immutable', entry);
  assert.deepEqual(brotliDecompressSync(readFileSync(`${entryPath}.br`)), readFileSync(entryPath));
  assert.ok(statSync(`${entryPath}.br`).size < statSync(`${entryPath}.gz`).size);
  assert.ok(readdirSync(join(outDir, 'rnnoise')).includes('rnnoise.wasm.br'));

  // Web push: one self-contained module at the root, as SvelteKit emitted it.
  const serviceWorker = readFileSync(join(outDir, 'service-worker.js'), 'utf8');
  assert.ok(serviceWorker.includes('showNotification'));
  assert.doesNotMatch(serviceWorker, /(^|[;}])\s*import[\s{*]/m);
  // public/ is served from the root, next to index.html.
  assert.ok(readdirSync(outDir).includes('voiceroom-icon.svg'));
  assert.ok(readdirSync(join(outDir, 'rnnoise')).includes('rnnoise.wasm'));
}

// CI verifies the regular build in its build job. Local runs use a temporary build.
async function verifyProductionBuild(root: string, verify: (outDir: string) => void) {
  if (deployContractMode === 'built') {
    verify(join(root, 'dist'));
    return;
  }
  const outDir = mkdtempSync(join(tmpdir(), 'deploy-build-'));
  vi.stubEnv('LIVEKIT_DOMAIN', livekitDomain);
  // Vitest's test environment would leave import.meta.env.PROD false.
  vi.stubEnv('NODE_ENV', 'production');
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  try {
    await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    verify(outDir);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

test.skipIf(deployContractMode === 'checked')(
  'a production web build keeps the deployment contract',
  { timeout: 60_000 },
  () => verifyProductionBuild(webRoot, verifyDeployArtifacts)
);

function verifyWidgetArtifacts(outDir: string) {
  const html = readFileSync(join(outDir, 'embed', 'v1', 'index.html'), 'utf8');
  const policy = buildHeaderPolicy(readMetaPolicy(html), undefined, 'https:');
  assert.match(policy, /frame-ancestors https:/);
  assert.match(policy, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(policy, /connect-src 'self' wss:\/\/\{\$LIVEKIT_DOMAIN\}/);
  assert.ok(html.indexOf('http-equiv="content-security-policy"') < html.indexOf('<script'));
  const entry = html.match(/src="\/(_app\/immutable\/widget\/[^"]+\.js)"/)?.[1];
  assert.ok(entry, 'a separate archive path for the frame');
  const entryPath = join(outDir, entry);
  assert.deepEqual(brotliDecompressSync(readFileSync(`${entryPath}.br`)), readFileSync(entryPath));
  assert.equal(voiceAssetVersion(outDir), voiceAssetVersion());

  const loaderPath = join(outDir, 'widget', 'v1', 'loader.js');
  const loader = readFileSync(loaderPath);
  assert.ok(loader.length > 0);
  assert.deepEqual(brotliDecompressSync(readFileSync(`${loaderPath}.br`)), loader);
}

test.skipIf(deployContractMode === 'checked')(
  'a production widget build keeps the deployment contract',
  { timeout: 60_000 },
  () => verifyProductionBuild(widgetRoot, verifyWidgetArtifacts)
);

test('the dev server serves audio assets at browser module and fetch URLs', { timeout: 60_000 }, async () => {
  const server = await createServer({
    root: webRoot,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] }
  });
  const http = createHttpServer(server.middlewares);
  try {
    await new Promise<void>((done) => http.listen(0, '127.0.0.1', done));
    const address = http.address();
    assert.ok(address && typeof address !== 'string');
    assert.deepEqual(Object.values(voiceAssetUrls()), mediaPaths);
    for (const path of mediaPaths) {
      const request = path.endsWith('.mjs') ? `${path}?import` : path;
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        get(`http://127.0.0.1:${address.port}${request}`, resolve).once('error', reject);
      });
      const bytes = await buffer(response);
      assert.equal(response.statusCode, 200, path);
      assert.equal(response.headers['cache-control'], 'no-cache');
      assert.equal(response.headers['content-type'], path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
      assert.deepEqual(bytes, readFileSync(join(voiceAssetDirectory, path)));
    }
  } finally {
    await new Promise<void>((resolve, reject) => http.close((error) => (error ? reject(error) : resolve())));
    await server.close();
  }
});
