// The LiveKit library is fetched ahead of a call (features/room/prefetch.ts).
// A fetch that failed then, on a dropped connection, must not leave every
// later join failing with the same cached error.

import { expect, test, vi } from 'vitest';
import { freshImport } from '../helpers/fresh-module';

test('a failed LiveKit load is tried again by the next caller', async () => {
  let loads = 0;
  vi.doMock('@/features/room/client/media/livekit-client', () => {
    loads += 1;
    if (loads === 1) throw new Error('Failed to fetch dynamically imported module');
    return { Room: class {} };
  });
  const { loadLiveKitClient } = await freshImport(() => import('@/features/room/client/media/livekit-runtime'));

  await expect(loadLiveKitClient()).rejects.toThrow();
  await expect(loadLiveKitClient()).resolves.toHaveProperty('Room');
  expect(loads).toBe(2);
});

test('callers share one load while it succeeds', async () => {
  let loads = 0;
  vi.doMock('@/features/room/client/media/livekit-client', () => {
    loads += 1;
    return { Room: class {} };
  });
  const { loadLiveKitClient } = await freshImport(() => import('@/features/room/client/media/livekit-runtime'));

  const [first, second] = await Promise.all([loadLiveKitClient(), loadLiveKitClient()]);
  expect(first).toBe(second);
  expect(await loadLiveKitClient()).toBe(first);
  expect(loads).toBe(1);
});
