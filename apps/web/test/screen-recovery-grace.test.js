import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { ScreenRecoveryGraceController } from '../src/lib/features/room/client/recovery/screen-recovery-grace.js';

function clock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      let ready;
      do {
        ready = [...timers.entries()].filter(([, timer]) => timer.at <= now);
        for (const [id, timer] of ready) {
          timers.delete(id);
          timer.callback();
        }
      } while (ready.length);
    },
    pending: () => timers.size
  };
}

test('local media churn expires after eight seconds outside global recovery', () => {
  const fake = clock();
  const expired = [];
  const grace = new ScreenRecoveryGraceController({ now: fake.now, setTimeout: fake.setTimeout, clearTimeout: fake.clearTimeout });
  grace.schedule('peer', () => expired.push('peer'));
  fake.advance(7_999);
  assert.deepEqual(expired, []);
  fake.advance(1);
  assert.deepEqual(expired, ['peer']);
});

test('global recovery holds an elapsed local grace until successful convergence', () => {
  const fake = clock();
  const expired = [];
  const grace = new ScreenRecoveryGraceController({ now: fake.now, setTimeout: fake.setTimeout, clearTimeout: fake.clearTimeout });
  grace.beginGlobal(7);
  grace.schedule('peer', () => expired.push('peer'));
  fake.advance(12_000);
  assert.deepEqual(expired, []);
  grace.endGlobal(false);
  assert.deepEqual(expired, ['peer']);
});

test('republish cancels grace while terminal outcome and hard cap expire immediately', () => {
  const fake = clock();
  const expired = [];
  const grace = new ScreenRecoveryGraceController({
    globalHardCapMs: 20_000,
    now: fake.now,
    setTimeout: fake.setTimeout,
    clearTimeout: fake.clearTimeout
  });
  grace.beginGlobal(1);
  grace.schedule('restored', () => expired.push('restored'));
  grace.cancel('restored');
  fake.advance(20_000);
  assert.deepEqual(expired, []);

  grace.beginGlobal(2);
  grace.schedule('terminal', () => expired.push('terminal'));
  grace.endGlobal(true);
  assert.deepEqual(expired, ['terminal']);

  grace.beginGlobal(3);
  grace.schedule('capped', () => expired.push('capped'));
  fake.advance(20_000);
  assert.deepEqual(expired, ['terminal', 'capped']);
  assert.equal(fake.pending(), 0);
});

test('authoritative stop cancels a pending media-only grace', () => {
  const fake = clock();
  let expired = false;
  const grace = new ScreenRecoveryGraceController({ now: fake.now, setTimeout: fake.setTimeout, clearTimeout: fake.clearTimeout });
  grace.schedule('peer', () => { expired = true; });
  grace.authoritativeStop('peer');
  fake.advance(8_000);
  assert.equal(expired, false);
});

test('global hard deadline is absolute across recovery epoch churn', () => {
  const fake = clock();
  const expired = [];
  const grace = new ScreenRecoveryGraceController({
    globalHardCapMs: 20_000,
    now: fake.now,
    setTimeout: fake.setTimeout,
    clearTimeout: fake.clearTimeout
  });
  grace.beginGlobal(1);
  grace.schedule('peer', () => expired.push('peer'));
  fake.advance(15_000);
  grace.beginGlobal(2);
  fake.advance(4_999);
  assert.deepEqual(expired, []);
  fake.advance(1);
  assert.deepEqual(expired, ['peer']);
});

test('authoritative screen intent wins over stale LiveKit media availability', () => {
  const livekit = fs.readFileSync(
    new URL('../src/lib/features/room/client/services/livekit-service.ts', import.meta.url),
    'utf8'
  );
  assert.match(livekit, /peer\.screenAuthoritative === false/);
  assert.match(livekit, /peer\.screen = false;[\s\S]{0,100}peer\.screenAudio = false;/);
});
