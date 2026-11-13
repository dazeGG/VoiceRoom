// What the edge answers on the main domain now that `/` is the public site
// (apps/site) and the app starts at /app: who gets which page, what search
// engines may index, and what an unknown address answers.

import assert from 'node:assert/strict';
import { test } from 'vitest';
import { routes } from '../src/router.ts';
import { dockerAvailable, startCaddyEdge } from './helpers/caddy-edge.ts';

const SITE = {
  'index.html': '<!doctype html><title>site home</title>',
  'download.html': '<!doctype html><title>site download</title>',
  '404.html': '<!doctype html><title>site 404</title>',
  'robots.txt': 'User-agent: *',
  '_astro/site.css': 'body{}'
};
const APP_FILES = { 'service-worker.js': '// worker', '_app/version.json': '{}' };

async function get(origin: string, path: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${origin}${path}`, { headers, redirect: 'manual' });
  return { status: response.status, headers: response.headers, body: await response.text() };
}

test(
  'a visitor gets the site at `/`, a signed-in browser and a link with a query go on to the app',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge({ files: APP_FILES, siteFiles: SITE });

    const visitor = await get(origin, '/');
    assert.equal(visitor.status, 200);
    assert.match(visitor.body, /site home/);

    const signedIn = await get(origin, '/', { cookie: 'theme=ice; vr_session=abc' });
    assert.equal(signedIn.status, 302);
    assert.equal(signedIn.headers.get('location'), '/app');

    // A notification's route and an old lobby link keep their query.
    const notification = await get(origin, '/?room=r1&message=m1');
    assert.equal(notification.status, 302);
    assert.equal(notification.headers.get('location'), '/app?room=r1&message=m1');

    assert.equal((await get(origin, '/?auth=login')).headers.get('location'), '/app?auth=login');

    // Another cookie that only ends in the same name is not a session.
    assert.equal((await get(origin, '/', { cookie: 'old_vr_session=' })).status, 200);

    // Ad and social links carry their own query; the visitor still gets the site.
    for (const path of ['/?utm_source=vk&utm_medium=post', '/?yclid=123', '/?gclid=abc&fbclid=x']) {
      const tagged = await get(origin, path);
      assert.equal(tagged.status, 200, path);
      assert.match(tagged.body, /site home/, path);
    }
  }
);

test(
  'the app answers on its own addresses and the site on its pages',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge({ files: APP_FILES, siteFiles: SITE });

    // Every address the app's router knows, so a route added there cannot be a 404 here.
    const appPaths = routes
      .map((route) => route.path)
      .filter((path) => path !== '/' && !path.includes('('))
      .map((path) => path.replace(/:[a-zA-Z]+/g, 'abc123'));
    assert.ok(appPaths.includes('/app') && appPaths.includes('/r/abc123'));
    for (const path of [...appPaths, '/app?auth=login']) {
      const page = await get(origin, path);
      assert.equal(page.status, 200, path);
      assert.match(page.body, /web/, path);
    }

    const download = await get(origin, '/download');
    assert.equal(download.status, 200);
    assert.match(download.body, /site download/);
    assert.equal((await get(origin, '/robots.txt')).body, 'User-agent: *');
    assert.equal((await get(origin, '/service-worker.js')).body, '// worker');

    const css = await get(origin, '/_astro/site.css');
    assert.equal(css.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  }
);

test(
  'an unknown page is a 404 with the site 404 page; a missing script stays a bare 404',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    const origin = await startCaddyEdge({ files: APP_FILES, siteFiles: SITE });

    const missing = await get(origin, '/no-such-page');
    assert.equal(missing.status, 404);
    assert.match(missing.body, /site 404/);
    assert.ok(missing.headers.get('content-security-policy'), 'the 404 page keeps the policy');

    // The site's own 404 and index files have no address of their own: no soft
    // 404 with status 200, no second address of the home page.
    for (const path of ['/404', '/404.html', '/index']) {
      assert.equal((await get(origin, path)).status, 404, path);
    }
    assert.doesNotMatch((await get(origin, '/index.html')).body, /site home/);

    for (const path of ['/_app/immutable/gone-123.js', '/_astro/gone.css', '/old-worker.js']) {
      const asset = await get(origin, path);
      assert.equal(asset.status, 404, path);
      assert.doesNotMatch(asset.body, /site 404/, path);
    }
  }
);

test(
  'only the public host is indexed, and never the app pages',
  { skip: !dockerAvailable, timeout: 60_000 },
  async () => {
    // The test edge is reached as 127.0.0.1, so naming it the public host is the production case.
    const publicHost = await startCaddyEdge({
      env: { CANONICAL_HOST: '127.0.0.1' },
      files: APP_FILES,
      siteFiles: SITE
    });
    assert.equal((await get(publicHost, '/')).headers.get('x-robots-tag'), null);
    assert.equal((await get(publicHost, '/download')).headers.get('x-robots-tag'), null);
    for (const path of ['/app', '/r/abc123', '/login', '/register']) {
      assert.equal((await get(publicHost, path)).headers.get('x-robots-tag'), 'noindex', path);
    }

    // Any other host (dev, a self-hosted copy) is kept out entirely.
    const otherHost = await startCaddyEdge({ files: APP_FILES, siteFiles: SITE });
    assert.equal((await get(otherHost, '/')).headers.get('x-robots-tag'), 'noindex');
  }
);
