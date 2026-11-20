import assert from 'node:assert/strict';
import { test } from 'vitest';
import { dockerAvailable, startCaddyEdge } from './helpers/caddy-edge.ts';

test(
  'only embed permits external framing; stable loader revalidates and missing assets remain 404',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge({
      files: {
        'embed/v1/index.html': '<!doctype html><html><body>guest</body></html>',
        'widget/v1/loader.js': '// loader',
        '_app/immutable/widget/current.js': '// current widget frame'
      },
      archivedFiles: {
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
