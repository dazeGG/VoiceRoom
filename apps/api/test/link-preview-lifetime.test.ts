import assert from 'node:assert/strict';
import http from 'node:http';
import test, { type TestContext } from 'node:test';
import { createLinkPreviewFetcher } from '../src/lib/link-preview-fetcher.ts';

async function site(t: TestContext, handle: http.RequestListener) {
  const server = http.createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

const localOnly = {
  isAllowedAddress: (address: string) => address === '127.0.0.1',
  isAllowedPort: () => true
};

function observeClose(response: http.ServerResponse) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('discarded response remained open')), 1000);
    response.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

test('discarded responses close after settlement, including redirect refusals', async (t) => {
  const cases = [
    { status: 503, headers: {}, code: 'bad_status' },
    { status: 200, headers: { 'Content-Type': 'application/json' }, code: 'unsupported_type' },
    { status: 302, headers: { Location: 'http://[' }, code: 'unsupported_url' },
    { status: 302, headers: { Location: '/again' }, code: 'too_many_redirects' }
  ];
  for (const scenario of cases) {
    await t.test(scenario.code, async (t) => {
      let closed = Promise.resolve();
      const origin = await site(t, (_request, response) => {
        closed = observeClose(response);
        // Observe the rejection immediately, even if the fetch itself stalls.
        void closed.catch(() => {});
        response.writeHead(scenario.status, scenario.headers);
        response.write('small finite prefix');
      });
      const fetcher = createLinkPreviewFetcher({
        ...localOnly,
        maxRedirects: scenario.code === 'too_many_redirects' ? 0 : 3
      });
      await assert.rejects(fetcher.fetchPage(origin), { code: scenario.code });
      await closed;
    });
  }
});

test('a redirect disposes its unfinished body and repeated fetches remain usable', async (t) => {
  const closures: Promise<void>[] = [];
  const origin = await site(t, (request, response) => {
    if (request.url === '/page') {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>ready</title>');
      return;
    }
    const closed = observeClose(response);
    void closed.catch(() => {});
    closures.push(closed);
    response.writeHead(302, { Location: '/page' });
    response.write('small finite prefix');
  });
  const fetcher = createLinkPreviewFetcher(localOnly);
  for (let index = 0; index < 3; index += 1) {
    const page = await fetcher.fetchPage(origin);
    assert.equal(page.body.toString(), '<title>ready</title>');
    await closures[index];
  }
  assert.equal(closures.length, 3);
});

test('stalled accepted bodies and redirect hops share a bounded deadline', async (t) => {
  for (const redirect of [false, true]) {
    await t.test(redirect ? 'redirect deadline' : 'body deadline', async (t) => {
      const closures: Promise<void>[] = [];
      let requests = 0;
      const origin = await site(t, (_request, response) => {
        requests += 1;
        const closed = observeClose(response);
        void closed.catch(() => {});
        closures.push(closed);
        if (redirect) {
          const timer = setTimeout(() => response.writeHead(302, { Location: '/again' }).end(), 60);
          response.once('close', () => clearTimeout(timer));
        } else {
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.write('small finite prefix');
        }
      });
      const fetcher = createLinkPreviewFetcher({ ...localOnly, timeoutMs: 100, maxRedirects: 50 });
      await assert.rejects(fetcher.fetchPage(origin), { code: 'timeout' });
      await Promise.all(closures);
      assert.ok(requests >= 1 && requests < 5, 'the deadline bounds the entire operation');
    });
  }
});
