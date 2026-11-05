// What is fetched ahead of a join, so the click finds it in the cache: the
// microphone otherwise loads these files one after another, a round trip each.

import { expect, test, vi } from 'vitest';
import { stubFetch } from '../fixtures/fetch';

vi.mock('@/features/room/RoomPage.vue', () => ({ default: {} }));
vi.mock('@/features/room/client/main', () => ({}));
vi.mock('@/features/room/client/media/livekit-runtime', () => ({ loadLiveKitClient: vi.fn(async () => ({})) }));

test('the noise suppression files are fetched before the visitor asks to join', async () => {
  const { calls } = stubFetch({});
  const { prefetchRoom } = await import('@/features/room/prefetch');
  const { MICROPHONE_ASSET_URLS } = await import('@/features/room/client/core/config');

  prefetchRoom();

  await vi.waitFor(() => expect(calls.map((call) => call.url)).toEqual([...MICROPHONE_ASSET_URLS]));
});

test('a prefetch that fails is dropped: the real load asks again', async () => {
  const failing = vi.fn(async () => {
    throw new Error('offline');
  });
  vi.stubGlobal('fetch', failing);
  const { prefetchRoom } = await import('@/features/room/prefetch');
  const { MICROPHONE_ASSET_URLS } = await import('@/features/room/client/core/config');

  expect(() => prefetchRoom()).not.toThrow();

  await vi.waitFor(() => expect(failing).toHaveBeenCalledTimes(MICROPHONE_ASSET_URLS.length));
});
