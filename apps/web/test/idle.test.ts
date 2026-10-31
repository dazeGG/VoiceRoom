// whenIdle runs deferred work after the page has loaded, in an idle moment,
// and its cancel stops the work at any point before it runs.

import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { whenIdle } from '@/shared/utils/idle';
import { stubWindow } from './helpers/fresh-module';

afterEach(() => {
  vi.useRealTimers();
});

// jsdom's document is always complete; this shadows the getter for one test.
function stubReadyState(state: DocumentReadyState): void {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => state });
  onTestFinished(() => {
    Reflect.deleteProperty(document, 'readyState');
  });
}

function fakeIdleCallbacks() {
  const pending = new Map<number, () => void>();
  let next = 1;
  stubWindow({
    requestIdleCallback: (callback: () => void) => {
      pending.set(next, callback);
      return next++;
    },
    cancelIdleCallback: (handle: number) => pending.delete(handle)
  });
  return {
    pending,
    runIdle: () => {
      for (const callback of [...pending.values()]) callback();
      pending.clear();
    }
  };
}

test('a loaded page runs the task in its next idle moment', () => {
  const idle = fakeIdleCallbacks();
  const task = vi.fn();
  whenIdle(task);
  expect(task).not.toHaveBeenCalled();
  idle.runIdle();
  expect(task).toHaveBeenCalledTimes(1);
});

test('a page still loading waits for the load event before it schedules', () => {
  stubReadyState('loading');
  const idle = fakeIdleCallbacks();
  const task = vi.fn();
  whenIdle(task);
  expect(idle.pending.size).toBe(0);
  window.dispatchEvent(new Event('load'));
  idle.runIdle();
  expect(task).toHaveBeenCalledTimes(1);
});

test('cancelled before the page loads, the task is never scheduled', () => {
  stubReadyState('loading');
  const idle = fakeIdleCallbacks();
  const task = vi.fn();
  whenIdle(task)();
  window.dispatchEvent(new Event('load'));
  expect(idle.pending.size).toBe(0);
  expect(task).not.toHaveBeenCalled();
});

test('cancelled while waiting for idle, the task never runs', () => {
  const idle = fakeIdleCallbacks();
  const task = vi.fn();
  whenIdle(task)();
  expect(idle.pending.size).toBe(0);
  idle.runIdle();
  expect(task).not.toHaveBeenCalled();
});

test('without requestIdleCallback the task runs after a short pause, and cancel stops it', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  stubWindow({ requestIdleCallback: undefined, cancelIdleCallback: undefined });
  const ran = vi.fn();
  const dropped = vi.fn();
  whenIdle(ran);
  const cancel = whenIdle(dropped);
  cancel();
  vi.advanceTimersByTime(1_000);
  expect(ran).toHaveBeenCalledTimes(1);
  expect(dropped).not.toHaveBeenCalled();
});
