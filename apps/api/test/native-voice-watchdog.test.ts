import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
  createNativeVoiceWatchdog,
  MAX_NATIVE_VOICE_WATCHES
} from '../src/domains/admission/native-voice-watchdog.service.ts';

test('the watchdog cuts a live tunnel when a refresh returns a deadline that has passed', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_000 });
  const removed: string[] = [];
  const watchdog = createNativeVoiceWatchdog({
    async remove(_room, identity) {
      removed.push(identity);
    },
    report(error) {
      assert.fail(String(error));
    }
  });
  watchdog.start();
  t.after(() => watchdog.stop());
  const window = { room: 'room', identity: 'native-peer#voice.lease', deadline: 6_000, expiresAt: 61_000 };
  let closed = false;
  assert.ok(
    watchdog.track(
      window,
      async () => ({ deadline: 1_900, expiresAt: 61_000 }),
      () => {
        closed = true;
      }
    )
  );
  t.mock.timers.tick(1_000);
  await setImmediate();
  assert.ok(closed);
  assert.deepEqual(removed, [window.identity]);
  assert.equal(watchdog.allows(window), false);
});

test('the gate caps watch count, concurrent removals and time spent retrying', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_000 });
  const pending: (() => void)[] = [];
  const finals = new Set<string>();
  const watchdog = createNativeVoiceWatchdog({
    remove: async () =>
      new Promise<void>((_, reject) => pending.push(() => reject(new Error('RoomService unavailable')))),
    report: (_error, { identity }, final) => {
      if (final) {
        assert.ok(!finals.has(identity), 'each watch gets only one final attempt');
        finals.add(identity);
      }
    }
  });
  watchdog.start();
  t.after(() => watchdog.stop());
  for (let index = 0; index < MAX_NATIVE_VOICE_WATCHES; index += 1) {
    assert.equal(
      watchdog.recover({ room: 'room', identity: `peer#voice.${index}` }, undefined, async () => null),
      true
    );
  }
  const overflow = { room: 'room', identity: 'overflow#voice.pending' };
  assert.equal(
    watchdog.recover(overflow, undefined, async () => null),
    false
  );
  assert.equal(watchdog.allows({ ...overflow, deadline: 6_000, expiresAt: 60_000 }), false);
  assert.equal(watchdog.metrics().watches, MAX_NATIVE_VOICE_WATCHES);
  assert.equal(pending.length, 8);

  for (let second = 0; second < 125; second += 1) {
    t.mock.timers.tick(1_000);
    do {
      assert.ok(pending.length <= 8);
      for (const fail of pending.splice(0)) fail();
      await setImmediate();
    } while (pending.length > 0);
  }
  assert.equal(finals.size, MAX_NATIVE_VOICE_WATCHES);
  assert.deepEqual(watchdog.metrics(), { watches: 0, exhausted: MAX_NATIVE_VOICE_WATCHES });
  assert.equal(
    watchdog.recover(overflow, undefined, async () => null),
    true
  );
  for (const fail of pending.splice(0)) fail();
  await setImmediate();
});
