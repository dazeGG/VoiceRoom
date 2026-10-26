// The loader every section uses: an older answer never replaces a newer one,
// the poll waits for the request out and for a visible tab and stops with the
// section, a refresh asked in the same moment as the poll is one request, other
// inputs mean busy until their own answer, and a failure says why and keeps the
// last answer on screen.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { useAdminResource } from '../src/load-state.ts';

const FAILURE_TEXT = 'Не удалось загрузить';
const REFRESH_MS = 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

interface Pending<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
}

/** A fetcher whose every request stays out until the test answers it; it records what it was asked for. */
function heldFetcher<T>() {
  const requests: Pending<T>[] = [];
  const fetcher = vi.fn((_input?: string) => {
    let resolve: (value: T) => void = () => undefined;
    let reject: (cause: unknown) => void = () => undefined;
    const promise = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    requests.push({ promise, resolve, reject });
    return promise;
  });
  function request(index: number): Pending<T> {
    const pending = requests[index];
    if (!pending) throw new Error(`request ${index} never went out`);
    return pending;
  }
  return { fetcher, request };
}

async function answer<T>(pending: Pending<T>, value: T): Promise<void> {
  await act(async () => pending.resolve(value));
}

async function fail<T>(pending: Pending<T>, cause: unknown): Promise<void> {
  await act(async () => pending.reject(cause));
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

test('an older answer that comes after a newer one is dropped', async () => {
  const { fetcher, request } = heldFetcher<string>();
  const { result } = renderHook(() => useAdminResource(fetcher, [], { failureText: FAILURE_TEXT }));
  expect(result.current.busy).toBe(true);

  act(() => result.current.reload());
  expect(fetcher).toHaveBeenCalledTimes(2);

  await answer(request(1), 'newer');
  expect(result.current.data).toBe('newer');
  expect(result.current.busy).toBe(false);

  await answer(request(0), 'older');
  expect(result.current.data).toBe('newer');
  expect(result.current.busy).toBe(false);
});

test('an older answer that comes first neither shows nor ends the wait, nor does its failure', async () => {
  const { fetcher, request } = heldFetcher<string>();
  const { result } = renderHook(() => useAdminResource(fetcher, [], { failureText: FAILURE_TEXT }));
  act(() => result.current.reload());
  act(() => result.current.reload());
  expect(fetcher).toHaveBeenCalledTimes(3);

  await answer(request(0), 'oldest');
  await fail(request(1), new Error('old failure'));
  expect(result.current.data).toBeNull();
  expect(result.current.failure).toBeNull();
  expect(result.current.busy).toBe(true);
  expect(result.current.loadedAt).toBeNull();

  await answer(request(2), 'newest');
  expect(result.current.data).toBe('newest');
  expect(result.current.busy).toBe(false);
});

test('the poll asks every refreshMs, skips while a request is out or the tab is hidden, and stops on unmount', async () => {
  const { fetcher, request } = heldFetcher<number>();
  const { result, unmount } = renderHook(() =>
    useAdminResource(fetcher, [], { failureText: FAILURE_TEXT, refreshMs: REFRESH_MS })
  );
  expect(fetcher).toHaveBeenCalledTimes(1);

  // The first request is still out: the poll does not pile on.
  await tick(REFRESH_MS * 3);
  expect(fetcher).toHaveBeenCalledTimes(1);

  await answer(request(0), 1);
  expect(result.current.busy).toBe(false);
  await tick(REFRESH_MS);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.current.busy).toBe(true);
  expect(result.current.data).toBe(1);

  vi.setSystemTime(2_000_000);
  await answer(request(1), 2);
  expect(result.current.data).toBe(2);
  expect(result.current.loadedAt).toBe(2_000_000);

  // A hidden tab does not ask; shown again with numbers older than a round, it asks at once.
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await tick(REFRESH_MS * 5);
  expect(fetcher).toHaveBeenCalledTimes(2);
  visibility.mockReturnValue('visible');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(fetcher).toHaveBeenCalledTimes(3);
  await answer(request(2), 3);
  // The tick right after that request does not ask again.
  await tick(REFRESH_MS / 4);
  expect(fetcher).toHaveBeenCalledTimes(3);

  // Hidden and shown again within a round: the numbers are fresh, no request.
  visibility.mockReturnValue('hidden');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  visibility.mockReturnValue('visible');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(fetcher).toHaveBeenCalledTimes(3);

  unmount();
  expect(vi.getTimerCount()).toBe(0);
  await tick(REFRESH_MS * 5);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test('a refresh asked in the same moment as the poll sends one request', async () => {
  const { fetcher, request } = heldFetcher<string>();
  const { result } = renderHook(() =>
    useAdminResource(fetcher, [], { failureText: FAILURE_TEXT, refreshMs: REFRESH_MS })
  );
  await answer(request(0), 'first');

  await act(async () => {
    result.current.reload();
    vi.advanceTimersByTime(REFRESH_MS);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.current.busy).toBe(true);

  await answer(request(1), 'second');
  expect(result.current.data).toBe('second');
  expect(result.current.busy).toBe(false);
});

test('a refresh after the poll went out wins, and the wait does not end on the poll answer', async () => {
  const { fetcher, request } = heldFetcher<string>();
  const busySeen: boolean[] = [];
  const { result } = renderHook(() => {
    const resource = useAdminResource(fetcher, [], { failureText: FAILURE_TEXT, refreshMs: REFRESH_MS });
    busySeen.push(resource.busy);
    return resource;
  });
  await answer(request(0), 'first');

  await tick(REFRESH_MS);
  act(() => result.current.reload());
  expect(fetcher).toHaveBeenCalledTimes(3);
  busySeen.length = 0;

  // The poll's answer is older than the refresh: nothing on screen changes.
  await answer(request(1), 'poll');
  expect(result.current.data).toBe('first');
  expect(busySeen.every(Boolean)).toBe(true);

  // While the refresh is out the poll skips.
  await tick(REFRESH_MS * 2);
  expect(fetcher).toHaveBeenCalledTimes(3);

  await answer(request(2), 'refresh');
  expect(result.current.data).toBe('refresh');
  expect(busySeen.slice(0, -1).every(Boolean)).toBe(true);
  expect(busySeen.at(-1)).toBe(false);
});

test('other inputs are busy at once and replace the data with their own answer', async () => {
  const { fetcher, request } = heldFetcher<string>();
  const { result, rerender } = renderHook(
    ({ view }: { view: string }) => useAdminResource(() => fetcher(view), [view], { failureText: FAILURE_TEXT }),
    { initialProps: { view: 'calls' } }
  );
  expect(fetcher).toHaveBeenLastCalledWith('calls');
  await answer(request(0), 'calls page');

  // The same inputs again ask nothing.
  rerender({ view: 'calls' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(result.current.busy).toBe(false);

  rerender({ view: 'timeline' });
  // Busy on the very render that switched; the last answer stays until the new one comes.
  expect(result.current.busy).toBe(true);
  expect(result.current.data).toBe('calls page');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher).toHaveBeenLastCalledWith('timeline');

  await answer(request(1), 'timeline day');
  expect(result.current.data).toBe('timeline day');
  expect(result.current.busy).toBe(false);
});

test('an answer for inputs already left behind is dropped', async () => {
  const { fetcher, request } = heldFetcher<string>();
  const { result, rerender } = renderHook(
    ({ view }: { view: string }) => useAdminResource(() => fetcher(view), [view], { failureText: FAILURE_TEXT }),
    { initialProps: { view: 'calls' } }
  );
  rerender({ view: 'timeline' });
  await answer(request(1), 'timeline day');
  await answer(request(0), 'calls page');
  expect(result.current.data).toBe('timeline day');
});

test('a failure says why, keeps the last answer and its time, and clears on the next answer', async () => {
  const { fetcher, request } = heldFetcher<string>();
  const { result } = renderHook(() => useAdminResource(fetcher, [], { failureText: FAILURE_TEXT }));
  await answer(request(0), 'kept');
  expect(result.current.loadedAt).toBe(1_000_000);

  // An error without a message falls back to the section's text.
  vi.setSystemTime(1_005_000);
  act(() => result.current.reload());
  await fail(request(1), new Error(''));
  expect(result.current.failure).toEqual({ kind: 'failed', message: FAILURE_TEXT });
  expect(result.current.data).toBe('kept');
  expect(result.current.busy).toBe(false);
  expect(result.current.loadedAt).toBe(1_000_000);
  expect(result.current.heardAt).toBe(1_005_000);

  act(() => result.current.reload());
  await fail(request(2), new Error('Сервер недоступен'));
  expect(result.current.failure).toEqual({ kind: 'failed', message: 'Сервер недоступен' });

  act(() => result.current.reload());
  await fail(request(3), new ApiError('Нет доступа', 403, 'forbidden'));
  expect(result.current.failure).toEqual({ kind: 'forbidden', message: '' });
  expect(result.current.data).toBe('kept');

  act(() => result.current.reload());
  await answer(request(4), 'fresh');
  expect(result.current.failure).toBeNull();
  expect(result.current.data).toBe('fresh');
});

test('a first request that fails leaves no data and is not busy', async () => {
  const { fetcher, request } = heldFetcher<string>();
  const { result } = renderHook(() => useAdminResource(fetcher, [], { failureText: FAILURE_TEXT }));
  await fail(request(0), 'not an error');
  expect(result.current.data).toBeNull();
  expect(result.current.failure).toEqual({ kind: 'failed', message: FAILURE_TEXT });
  expect(result.current.busy).toBe(false);
  expect(result.current.loadedAt).toBeNull();
});
