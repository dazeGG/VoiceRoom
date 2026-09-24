import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { MAX_PAGE_BYTES, createLinkPreviewFetcher, isPublicAddress } from '../src/lib/link-preview-fetcher.ts';

// A local site the tests reach through a fake DNS answer. The default address
// policy would refuse 127.0.0.1, so tests that need a real response allow only
// that one address and any port.
async function startSite(t, routes) {
  const server = http.createServer((request, response) => {
    const route = routes[new URL(request.url, 'http://site.test').pathname];
    if (!route) {
      response.writeHead(404).end();
      return;
    }
    route(request, response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  return `http://site.test:${server.address().port}`;
}

function resolvingTo(table) {
  return (hostname, _options, callback) => {
    const addresses = table[hostname];
    if (!addresses) {
      callback(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
      return;
    }
    callback(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  };
}

const localOnly = {
  lookup: resolvingTo({ 'site.test': ['127.0.0.1'], 'internal.test': ['10.0.0.8'] }),
  isAllowedAddress: (address) => address === '127.0.0.1',
  isAllowedPort: () => true
};

test('only public addresses count as reachable', () => {
  for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip', ''
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('a page is read through the vetted address, after redirects, and cut at the size limit', async (t) => {
  const origin = await startSite(t, {
    '/start': (_request, response) => response.writeHead(302, { Location: '/page' }).end(),
    '/page': (request, response) => {
      assert.match(request.headers['user-agent'], /VoiceRoomLinkPreview/);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<head><title>Страница</title></head>${'x'.repeat(MAX_PAGE_BYTES + 4096)}`);
    }
  });
  const fetcher = createLinkPreviewFetcher(localOnly);
  const page = await fetcher.fetchPage(`${origin}/start`);
  assert.equal(page.url, `${origin}/page`);
  assert.match(page.contentType, /^text\/html/);
  assert.equal(page.body.length, MAX_PAGE_BYTES);
  assert.match(page.body.toString('utf8'), /<title>Страница<\/title>/);
});

test('private destinations and unusual links are refused before any connection', async () => {
  const fetcher = createLinkPreviewFetcher({
    lookup: resolvingTo({ 'intranet.test': ['10.0.0.5'], 'mixed.test': ['93.184.216.34', '10.0.0.5'], 'public.test': ['93.184.216.34'] })
  });
  const refusals = [
    ['http://127.0.0.1/', 'blocked_address'],
    ['http://[::1]/', 'blocked_address'],
    ['http://169.254.169.254/latest/meta-data', 'blocked_address'],
    ['http://intranet.test/', 'blocked_address'],
    ['http://mixed.test/', 'blocked_address'],
    ['http://public.test:8080/', 'unsupported_url'],
    ['https://user:secret@public.test/', 'unsupported_url'],
    ['ftp://public.test/', 'unsupported_url'],
    ['not a url', 'unsupported_url']
  ];
  for (const [url, code] of refusals) {
    await assert.rejects(fetcher.fetchPage(url), { code }, url);
  }
});

test('a redirect into the private network is refused like a direct link', async (t) => {
  const origin = await startSite(t, {
    '/to-metadata': (_request, response) => response.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }).end(),
    '/to-intranet': (_request, response) => response.writeHead(301, { Location: 'http://internal.test/admin' }).end()
  });
  const fetcher = createLinkPreviewFetcher(localOnly);
  await assert.rejects(fetcher.fetchPage(`${origin}/to-metadata`), { code: 'blocked_address' });
  await assert.rejects(fetcher.fetchPage(`${origin}/to-intranet`), { code: 'blocked_address' });
});

test('loops, wrong types, missing pages, oversized images and slow sites fail with a reason', async (t) => {
  const origin = await startSite(t, {
    '/loop': (_request, response) => response.writeHead(302, { Location: '/loop' }).end(),
    '/json': (_request, response) => response.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'),
    '/big.png': (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': String(6 * 1024 * 1024) });
      response.write(Buffer.alloc(1024));
    },
    '/chunked.png': (_request, response) => {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      for (let index = 0; index < 6; index += 1) response.write(Buffer.alloc(1024 * 1024));
      response.end();
    },
    '/slow': () => {}
  });
  const fetcher = createLinkPreviewFetcher({ ...localOnly, timeoutMs: 300 });
  await assert.rejects(fetcher.fetchPage(`${origin}/loop`), { code: 'too_many_redirects' });
  await assert.rejects(fetcher.fetchPage(`${origin}/json`), { code: 'unsupported_type' });
  await assert.rejects(fetcher.fetchPage(`${origin}/missing`), { code: 'bad_status' });
  await assert.rejects(fetcher.fetchImage(`${origin}/big.png`), { code: 'too_large' });
  await assert.rejects(createLinkPreviewFetcher(localOnly).fetchImage(`${origin}/chunked.png`), { code: 'too_large' });
  await assert.rejects(fetcher.fetchPage(`${origin}/slow`), { code: 'timeout' });
});
