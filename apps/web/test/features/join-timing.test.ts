// What a join measures of itself: each stage the first time it is reached, the
// whole measure handed over once, and a listener's stages still in order.

import { expect, test, vi } from 'vitest';

async function load() {
  vi.resetModules();
  return import('@/features/room/client/room/join-timing');
}

function stubClock(times: number[]) {
  vi.spyOn(performance, 'now').mockImplementation(() => times.shift() ?? 0);
}

test('stages are milliseconds since the join started, and the finished measure is given once', async () => {
  const { finishJoinTiming, markJoinStage, startJoinTiming, takeJoinTiming } = await load();
  stubClock([1000, 1100, 1300, 2000, 2200, 2210]);

  startJoinTiming();
  markJoinStage('microphoneMs');
  markJoinStage('tokenMs');
  markJoinStage('connectMs');
  markJoinStage('publishMs');
  expect(takeJoinTiming()).toBeNull();
  finishJoinTiming();

  expect(takeJoinTiming()).toEqual({
    microphoneMs: 100,
    tokenMs: 300,
    connectMs: 1000,
    publishMs: 1200,
    totalMs: 1210
  });
  expect(takeJoinTiming()).toBeNull();
});

test('a retried stage keeps its first time', async () => {
  const { finishJoinTiming, markJoinStage, startJoinTiming, takeJoinTiming } = await load();
  stubClock([0, 100, 500, 600]);

  startJoinTiming();
  markJoinStage('tokenMs');
  markJoinStage('tokenMs');
  finishJoinTiming();

  expect(takeJoinTiming()?.tokenMs).toBe(100);
});

test('someone joining to listen, with no microphone to publish, reports stages still in order', async () => {
  const { finishJoinTiming, markJoinStage, startJoinTiming, takeJoinTiming } = await load();
  stubClock([0, 200, 900, 950]);

  startJoinTiming();
  markJoinStage('tokenMs');
  markJoinStage('connectMs');
  finishJoinTiming();

  expect(takeJoinTiming()).toEqual({ microphoneMs: 200, tokenMs: 200, connectMs: 900, publishMs: 900, totalMs: 950 });
});

test('a new join starts over, and marks with no join running are ignored', async () => {
  const { finishJoinTiming, markJoinStage, startJoinTiming, takeJoinTiming } = await load();
  stubClock([0, 100, 200, 5000, 5300, 5400]);

  markJoinStage('tokenMs');
  finishJoinTiming();
  expect(takeJoinTiming()).toBeNull();

  startJoinTiming();
  markJoinStage('tokenMs');
  markJoinStage('connectMs');
  startJoinTiming();
  markJoinStage('tokenMs');
  finishJoinTiming();

  expect(takeJoinTiming()?.tokenMs).toBe(300);
});
