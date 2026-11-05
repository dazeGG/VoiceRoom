// A page's measures go to our own server only, and survive the page closing.

import { beforeEach, expect, test, vi } from 'vitest';

type Report = (metric: { name: string; value: number }) => void;
const reporters = vi.hoisted(() => new Map<string, Report>());

vi.mock('web-vitals', () => ({
  onCLS: (report: Report) => reporters.set('CLS', report),
  onFCP: (report: Report) => reporters.set('FCP', report),
  onINP: (report: Report) => reporters.set('INP', report),
  onLCP: (report: Report) => reporters.set('LCP', report),
  onTTFB: (report: Report) => reporters.set('TTFB', report)
}));

beforeEach(() => reporters.clear());

async function start() {
  const { startWebVitals } = await import('@/platform/web-vitals');
  await startWebVitals();
}

test('every measure is watched, and goes out as a beacon to our own server', async () => {
  const sendBeacon = vi.fn((_url: string, _body: Blob) => true);
  vi.stubGlobal('navigator', { sendBeacon });
  await start();
  expect([...reporters.keys()].sort()).toEqual(['CLS', 'FCP', 'INP', 'LCP', 'TTFB']);

  reporters.get('LCP')?.({ name: 'LCP', value: 1234.6 });

  const [url, body] = sendBeacon.mock.calls[0] ?? [];
  expect(url).toBe('/api/client-vitals');
  expect(body?.type).toBe('application/json');
  expect(await body?.text()).toBe(JSON.stringify({ name: 'LCP', value: 1235 }));
});

test('CLS, which has no unit, goes out in thousandths', async () => {
  const sendBeacon = vi.fn((_url: string, _body: Blob) => true);
  vi.stubGlobal('navigator', { sendBeacon });
  await start();

  reporters.get('CLS')?.({ name: 'CLS', value: 0.125 });

  expect(await sendBeacon.mock.calls[0]?.[1].text()).toBe(JSON.stringify({ name: 'CLS', value: 125 }));
});

test('a beacon the browser refuses falls back to a request that outlives the page', async () => {
  vi.stubGlobal('navigator', { sendBeacon: () => false });
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  await start();

  reporters.get('FCP')?.({ name: 'FCP', value: 300 });

  expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/client-vitals');
  expect(fetchMock.mock.calls[0]?.[1].keepalive).toBe(true);
});
