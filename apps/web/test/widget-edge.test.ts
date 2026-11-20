import assert from 'node:assert/strict';
import { test } from 'vitest';
import { dockerAvailable, startCaddyEdge } from './helpers/caddy-edge.ts';

test(
  'only embed permits external framing; stable loader revalidates and missing assets remain 404',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge({
      widgetFiles: {
        'embed/v1/index.html': '<!doctype html><html><body>guest</body></html>',
        'widget/v1/loader.js': '// loader',
        '_app/immutable/widget/current.js': '// current widget frame'
      },
      widgetArchiveFiles: {
        '_app/immutable/widget/older.js': '// older widget frame',
        '_app/immutable/legacy-loader-dependency.js': '// older public loader dependency'
      }
    });
    const embed = await fetch(`${origin}/embed/v1`);
    assert.equal(embed.status, 200);
    assert.equal(embed.headers.get('x-frame-options'), null);
    assert.match(embed.headers.get('content-security-policy') ?? '', /frame-ancestors https:/);
    assert.doesNotMatch(embed.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.match(embed.headers.get('permissions-policy') ?? '', /display-capture=\(\)/);
    assert.equal(embed.headers.get('cache-control'), 'no-cache');
    assert.equal(embed.headers.get('access-control-allow-origin'), null);
    for (const path of ['/embed/v1/', '/embed/v1/index.html']) {
      const alias = await fetch(`${origin}${path}`);
      assert.equal(alias.status, 200, path);
      assert.equal(alias.headers.get('content-security-policy'), embed.headers.get('content-security-policy'));
    }
    const app = await fetch(`${origin}/app`);
    assert.equal(app.headers.get('x-frame-options'), 'DENY');
    assert.match(app.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    const loader = await fetch(`${origin}/widget/v1/loader.js`);
    assert.equal(loader.status, 200);
    assert.equal(loader.headers.get('cache-control'), 'no-cache');
    assert.equal(loader.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(loader.headers.get('access-control-allow-origin'), '*');
    for (const release of ['current', 'older']) {
      const chunk = await fetch(`${origin}/_app/immutable/widget/${release}.js`);
      assert.equal(chunk.status, 200);
      assert.equal(await chunk.text(), `// ${release} widget frame`);
      assert.equal(chunk.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.equal(chunk.headers.get('access-control-allow-origin'), null);
      assert.equal(chunk.headers.get('cross-origin-resource-policy'), null);
    }
    const oldDependency = await fetch(`${origin}/_app/immutable/legacy-loader-dependency.js`);
    assert.equal(oldDependency.status, 200);
    assert.equal(oldDependency.headers.get('access-control-allow-origin'), '*');
    assert.equal(oldDependency.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal((await fetch(`${origin}/_app/immutable/widget/missing.js`)).status, 404);
  }
);

test(
  'web and widget release hashes serve their own worklet and WASM bytes',
  {
    skip: !dockerAvailable,
    timeout: 60_000
  },
  async () => {
    const webVersion = 'f0e1d2c3b4a5';
    const widgetVersion = '0123456789ab';
    const voiceFiles = {
      'audio-gate.worklet.js': '// worklet',
      'rnnoise/rnnoise.wasm': 'wasm'
    };
    const origin = await startCaddyEdge({
      files: voiceFiles,
      archivedFiles: Object.fromEntries(
        Object.entries(voiceFiles).map(([file, bytes]) => [`_voice/${webVersion}/${file}`, `${bytes} web`])
      ),
      widgetArchiveFiles: Object.fromEntries(
        Object.entries(voiceFiles).map(([file, bytes]) => [`_voice/${widgetVersion}/${file}`, `${bytes} widget`])
      )
    });
    for (const [version, client] of [
      [webVersion, 'web'],
      [widgetVersion, 'widget']
    ]) {
      for (const [file, bytes] of Object.entries(voiceFiles)) {
        const response = await fetch(`${origin}/${file}?v=${version}`);
        assert.equal(response.status, 200, file);
        assert.equal(await response.text(), `${bytes} ${client}`);
        assert.match(
          response.headers.get('content-type') ?? '',
          file.endsWith('.wasm') ? /application\/wasm/ : /javascript/
        );
        assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      }
    }
  }
);
