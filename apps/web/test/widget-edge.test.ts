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
        'widget/v1/loader.js': '// loader'
      }
    });
    const embed = await fetch(`${origin}/embed/v1`);
    assert.equal(embed.status, 200);
    assert.equal(embed.headers.get('x-frame-options'), null);
    assert.match(embed.headers.get('content-security-policy') ?? '', /frame-ancestors https:/);
    assert.doesNotMatch(embed.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.match(embed.headers.get('permissions-policy') ?? '', /display-capture=\(\)/);
    assert.equal(embed.headers.get('cache-control'), 'no-cache');
    const app = await fetch(`${origin}/app`);
    assert.equal(app.headers.get('x-frame-options'), 'DENY');
    assert.match(app.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    const loader = await fetch(`${origin}/widget/v1/loader.js`);
    assert.equal(loader.status, 200);
    assert.equal(loader.headers.get('cache-control'), 'no-cache');
    assert.equal(loader.headers.get('cross-origin-resource-policy'), 'cross-origin');
    assert.equal(loader.headers.get('access-control-allow-origin'), '*');
    assert.equal((await fetch(`${origin}/_app/immutable/widget-missing.js`)).status, 404);
  }
);
