import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createTrailingTask } from '@/shared/utils/trailing-task';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

test('a burst of calls ends in one run, a moment after the first', () => {
  const task = vi.fn();
  const trailing = createTrailingTask(1000, task);

  trailing.schedule();
  vi.advanceTimersByTime(600);
  trailing.schedule();
  trailing.schedule();
  expect(task).not.toHaveBeenCalled();

  vi.advanceTimersByTime(400);
  expect(task).toHaveBeenCalledTimes(1);
});

test('a call after the run starts a new one', () => {
  const task = vi.fn();
  const trailing = createTrailingTask(1000, task);

  trailing.schedule();
  vi.advanceTimersByTime(1000);
  trailing.schedule();
  vi.advanceTimersByTime(1000);

  expect(task).toHaveBeenCalledTimes(2);
});

test('a cancelled run does not happen, and the next call still can', () => {
  const task = vi.fn();
  const trailing = createTrailingTask(1000, task);

  trailing.schedule();
  trailing.cancel();
  vi.advanceTimersByTime(5000);
  expect(task).not.toHaveBeenCalled();

  trailing.schedule();
  vi.advanceTimersByTime(1000);
  expect(task).toHaveBeenCalledTimes(1);
});
