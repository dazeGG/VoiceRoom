import test from 'node:test';
import assert from 'node:assert/strict';

import { createFailureLimiter } from '../src/lib/rate-limit.js';

test('reserve counts the attempt before verification, so a parallel burst stops at the limit', () => {
  const limiter = createFailureLimiter({ limit: 3, windowMs: 60_000 });
  const results = Array.from({ length: 10 }, () => limiter.reserve('victim', 1_000).allowed);
  assert.deepEqual(results, [true, true, true, false, false, false, false, false, false, false]);
});

test('a successful sign-in clears the reserved attempts', () => {
  const limiter = createFailureLimiter({ limit: 2, windowMs: 60_000 });
  limiter.reserve('owner', 1_000);
  limiter.reserve('owner', 1_000);
  limiter.reset('owner');
  assert.equal(limiter.reserve('owner', 1_000).allowed, true);
});

test('the window expires and reports how long is left', () => {
  const limiter = createFailureLimiter({ limit: 1, windowMs: 10_000 });
  limiter.reserve('a', 0);
  const blocked = limiter.reserve('a', 4_000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 6);
  assert.equal(limiter.reserve('a', 10_000).allowed, true);
});

test('attacker-chosen keys are swept after a window and capped in number', () => {
  const limiter = createFailureLimiter({ limit: 5, windowMs: 1_000, maxEntries: 50 });
  for (let i = 0; i < 500; i += 1) limiter.reserve(`random-${i}`, 0);
  assert.ok(limiter.entries.size <= 50, `map grew to ${limiter.entries.size}`);
  limiter.reserve('late', 5_000);
  assert.equal(limiter.entries.size, 1, 'expired keys are gone after the window');
});

test('a disabled limiter never blocks', () => {
  const limiter = createFailureLimiter({ limit: 0, windowMs: 1_000 });
  for (let i = 0; i < 20; i += 1) assert.equal(limiter.reserve('x').allowed, true);
});
