// A client that re-reads one thing in a loop is held, so its loop slows down;
// a client that reads each thing once or a few times never notices.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepeatReadBrake } from '../src/domains/messaging/repeat-read-brake.ts';

function brake(options: Parameters<typeof createRepeatReadBrake>[0] = {}) {
  const clock = { now: 0 };
  const holds: number[] = [];
  const release: Array<() => void> = [];
  const made = createRepeatReadBrake({
    allowed: 3,
    quietMs: 1_000,
    holdMs: 500,
    now: () => clock.now,
    sleep: (ms) => {
      holds.push(ms);
      return new Promise<void>((resolve) => release.push(resolve));
    },
    ...options
  });
  return { clock, holds, release, admit: made.admit };
}

test('reads within the allowance pass at once, and every key has its own allowance', async () => {
  const { admit, holds } = brake();
  assert.deepEqual(await Promise.all([admit('a'), admit('a'), admit('a'), admit('b')]), [true, true, true, true]);
  assert.deepEqual(holds, []);
});

test('a repeat past the allowance is held for the hold time and then refused', async () => {
  const { admit, holds, release } = brake();
  for (let read = 0; read < 3; read += 1) await admit('a');

  let answer: boolean | null = null;
  const repeat = admit('a').then((value) => (answer = value));
  await Promise.resolve();
  assert.equal(answer, null, 'still held');
  assert.deepEqual(holds, [500]);

  release[0]?.();
  await repeat;
  assert.equal(answer, false);
});

test('a loop stays braked while it keeps asking, and a key left alone starts afresh', async () => {
  const { admit, clock, holds, release } = brake();
  for (let read = 0; read < 3; read += 1) await admit('a');

  // Asking again within the quiet time keeps the brake on, however long the loop runs.
  for (let lap = 0; lap < 4; lap += 1) {
    clock.now += 900;
    const repeat = admit('a');
    release.at(-1)?.();
    assert.equal(await repeat, false);
  }
  assert.equal(holds.length, 4);

  clock.now += 1_000;
  assert.equal(await admit('a'), true);
});

test('past the cap of held repeats the rest are refused at once, and old keys are forgotten', async () => {
  const { admit, holds, release } = brake({ allowed: 1, maxHeld: 1, maxKeys: 2 });
  await admit('a');
  const first = admit('a');
  assert.equal(await admit('a'), false, 'not held: one repeat is already waiting');
  assert.equal(holds.length, 1);
  release[0]?.();
  assert.equal(await first, false);

  // Two newer keys push "a" out; it then counts from the start again.
  await admit('b');
  await admit('c');
  assert.equal(await admit('a'), true);
});
