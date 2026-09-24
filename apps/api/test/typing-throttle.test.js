import test from 'node:test';
import assert from 'node:assert/strict';
import { createTypingThrottle } from '../src/realtime/typing-throttle.ts';

function createClock() {
  let time = 0;
  let timers = [];
  return {
    now: () => time,
    setTimer(callback, delay) {
      const timer = { at: time + delay, callback };
      timers.push(timer);
      return timer;
    },
    advance(ms) {
      time += ms;
      const due = timers.filter((timer) => timer.at <= time).sort((left, right) => left.at - right.at);
      timers = timers.filter((timer) => timer.at > time);
      for (const timer of due) timer.callback();
    }
  };
}

function setup(options = {}) {
  const clock = createClock();
  const throttle = createTypingThrottle({ minIntervalMs: 1000, now: clock.now, setTimer: clock.setTimer, ...options });
  const sent = [];
  const offer = (key, activity) => throttle.offer(key, activity, (value) => sent.push(`${key}:${value}`));
  return { clock, offer, sent, throttle };
}

test('a repeat of the same activity inside a second is dropped and the next second goes out', () => {
  const { clock, offer, sent } = setup();
  assert.equal(offer('room', 'typing'), true);
  clock.advance(400);
  assert.equal(offer('room', 'typing'), false);
  clock.advance(1000);
  assert.deepEqual(sent, ['room:typing'], 'a dropped repeat is not sent later');
  assert.equal(offer('room', 'typing'), true);
  assert.deepEqual(sent, ['room:typing', 'room:typing']);
});

test('a change of activity inside the second is sent when the second is up', () => {
  const { clock, offer, sent } = setup();
  offer('friend', 'typing');
  clock.advance(100);
  assert.equal(offer('friend', 'emoji'), false);
  clock.advance(899);
  assert.deepEqual(sent, ['friend:typing']);
  clock.advance(1);
  assert.deepEqual(sent, ['friend:typing', 'friend:emoji']);

  // Back to typing right after picking: held, never lost.
  clock.advance(200);
  offer('friend', 'typing');
  clock.advance(800);
  assert.deepEqual(sent, ['friend:typing', 'friend:emoji', 'friend:typing']);
});

test('the held notice carries what the person does by then, and is skipped when that is what was last sent', () => {
  const { clock, offer, sent } = setup();
  offer('room', 'typing');
  clock.advance(100);
  offer('room', 'emoji');
  clock.advance(100);
  offer('room', 'emoji');
  clock.advance(800);
  assert.deepEqual(sent, ['room:typing', 'room:emoji']);

  // Going back to typing inside the next second is a real change and goes out.
  clock.advance(100);
  offer('room', 'typing');
  clock.advance(1000);
  assert.deepEqual(sent, ['room:typing', 'room:emoji', 'room:typing']);

  clock.advance(100);
  offer('room', 'emoji');
  clock.advance(100);
  offer('room', 'typing');
  clock.advance(1000);
  assert.deepEqual(sent, ['room:typing', 'room:emoji', 'room:typing'], 'a round trip inside the second is not replayed late');
});

test('alternating activities cannot get past one notice a second, and targets do not share a budget', () => {
  const { clock, offer, sent } = setup();
  for (let step = 0; step < 20; step += 1) {
    offer('room', step % 2 ? 'emoji' : 'typing');
    offer('friend', 'typing');
    clock.advance(40);
  }
  clock.advance(200);
  assert.deepEqual(sent.filter((entry) => entry.startsWith('room:')), ['room:typing', 'room:emoji']);
  assert.deepEqual(sent.filter((entry) => entry.startsWith('friend:')), ['friend:typing']);
});

test('a connection cannot grow the throttle past its target limit', () => {
  const cleared = [];
  const { clock, offer, throttle } = setup({ maxTargets: 2, clearTimer: (timer) => cleared.push(timer) });

  offer('a', 'typing');
  // 'a' now waits out its second with a pending switch, so it holds a timer.
  offer('a', 'emoji');
  offer('b', 'typing');
  offer('c', 'typing');

  assert.equal(throttle.size(), 2, 'the least recently used target is dropped');
  assert.equal(cleared.length, 1, 'a dropped target does not leave its timer behind');

  // Dropping 'a' forgets when it last sent, so it is free to send again.
  clock.advance(100);
  assert.equal(offer('a', 'typing'), true);
  assert.equal(throttle.size(), 2);
});
