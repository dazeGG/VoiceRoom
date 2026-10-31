// SvelteKit's deploy check: the running build polls /_app/version.json and
// says once, when a different build is out.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createVersionCheck } from '../../src/features/app-update/version-check.ts';
import { stubFetch } from '../fixtures/fetch.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const answer = (version: string) => ({ body: { version } });

test('the same build answers false; a new one answers true once and stops the polling', async () => {
  let deployed = '100';
  const { calls } = stubFetch({ 'GET /_app/version.json': () => answer(deployed) });
  const onUpdated = vi.fn();
  const check = createVersionCheck({ version: '100', onUpdated, interval: 60_000 });

  expect(await check.check()).toBe(false);
  deployed = '200';
  expect(await check.check()).toBe(true);
  expect(onUpdated).toHaveBeenCalledTimes(1);

  const asked = calls.length;
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(calls).toHaveLength(asked);
  expect(await check.check()).toBe(true);
  expect(onUpdated).toHaveBeenCalledTimes(1);
  check.stop();
});

test('it asks again after each interval and bypasses the HTTP cache', async () => {
  let deployed = '100';
  const cacheControl: Array<string | null> = [];
  const { calls } = stubFetch({
    'GET /_app/version.json': (init) => {
      cacheControl.push(new Headers(init?.headers).get('cache-control'));
      return answer(deployed);
    }
  });
  const onUpdated = vi.fn();
  const check = createVersionCheck({ version: '100', onUpdated, interval: 60_000 });

  await vi.advanceTimersByTimeAsync(60_000);
  expect(calls).toHaveLength(1);
  expect(cacheControl).toEqual(['no-cache']);
  deployed = '200';
  await vi.advanceTimersByTimeAsync(60_000);
  expect(onUpdated).toHaveBeenCalledTimes(1);
  check.stop();
});

test('a missing file or a failed request is not an update', async () => {
  stubFetch({ 'GET /_app/version.json': { status: 404, body: {} } });
  const onUpdated = vi.fn();
  const check = createVersionCheck({ version: '100', onUpdated, interval: 0 });
  expect(await check.check()).toBe(false);

  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
  expect(await check.check()).toBe(false);
  expect(onUpdated).not.toHaveBeenCalled();
});

test('a dev server is never asked', async () => {
  const { calls } = stubFetch({ 'GET /_app/version.json': answer('200') });
  const check = createVersionCheck({ version: '100', onUpdated: vi.fn(), interval: 60_000, enabled: false });
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(await check.check()).toBe(false);
  expect(calls).toHaveLength(0);
});
