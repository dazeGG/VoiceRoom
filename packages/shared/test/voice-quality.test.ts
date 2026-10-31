// What a call sounds like: speech the receiver had to make up counts, loss the
// repair recovered does not; frequent gaps sound broken and long ones make
// speech impossible to follow, as a listener rated the loss bench; the room's
// reports say whose side the trouble is on; and a long delay makes a call
// unstable but never bad.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  judgeVoice,
  mouthToEarMs,
  streamLevel,
  type HeardCounts,
  type HeardStream,
  type VoiceReport
} from '../src/voice-quality.ts';

interface Line {
  concealedPct?: number;
  gapsPerMin?: number;
  lossPct?: number;
}

// Continuous speech: 50 packets of 960 samples a second.
const counts = (seconds: number, { concealedPct = 0, gapsPerMin = 0, lossPct = 0 }: Line = {}): HeardCounts => {
  const packets = seconds * 50;
  return {
    packets,
    lost: Math.round((packets * lossPct) / 100),
    concealedSamples: Math.round((packets * 960 * concealedPct) / 100),
    gaps: Math.round((gapsPerMin * seconds) / 60)
  };
};
/** A speaker heard the same way over the latest 3-second poll and the 15-second window. */
const heard = (senderId: string, line: Line = {}): HeardStream => ({
  senderId,
  latest: counts(3, line),
  window: counts(15, line)
});
const NOISY: Line = { concealedPct: 5, gapsPerMin: 60 };
const BROKEN: Line = { concealedPct: 20, gapsPerMin: 300 };

const report = (peerId: string, streams: HeardStream[], extra: Partial<VoiceReport> = {}): VoiceReport => ({
  peerId,
  rttMs: 30,
  jitterBufferMs: 40,
  uplinkLossPct: 0,
  heard: streams,
  ...extra
});
const verdicts = (reports: VoiceReport[]) => Object.fromEntries(judgeVoice(reports));
const good = { level: 'good', cause: null };

test('every loss bench step is classed as the listener rated it', () => {
  // [step, rating, concealed speech %, gaps per minute of speech], as the two runs measured them over 25 seconds.
  const steps: [string, 'good' | 'unstable' | 'bad', number, number][] = [
    ['clean line', 'good', 0, 0],
    ['random 1 %', 'good', 0, 0],
    ['random 3 %', 'good', 0.2, 5],
    ['random 5 %', 'good', 0.5, 7],
    ['jitter 50 ms', 'good', 0, 0],
    ['jitter 100 ms', 'good', 0.2, 7],
    ['bursts ~3 %', 'unstable', 0.6, 12],
    ['random 10 %', 'unstable', 0.7, 17],
    ['random 15 %', 'unstable', 2.4, 67],
    ['bursts ~10 %', 'unstable', 2.8, 58],
    ['random 20 %', 'unstable', 3.4, 91],
    ['random 20 % again', 'unstable', 4.7, 119],
    ['200 ms bursts ~10 %', 'unstable', 5.5, 55],
    ['random 30 %', 'unstable', 7.4, 168],
    ['bursts ~20 %', 'unstable', 7.8, 115],
    ['bursts ~30 %', 'unstable', 12.5, 224],
    ['random 40 %', 'unstable', 16.2, 304],
    ['200 ms bursts ~20 %', 'bad', 10.7, 101],
    ['bursts ~40 %', 'bad', 19.4, 296],
    ['random 50 %', 'bad', 22, 412],
    ['random 60 %', 'bad', 30.6, 443]
  ];
  for (const [step, rating, concealedPct, gapsPerMin] of steps) {
    const measured = counts(25, { concealedPct, gapsPerMin });
    assert.equal(streamLevel({ latest: measured, window: measured }), rating, step);
  }
});

test('loss that RED and FEC recovered is not heard, and too little speech says nothing', () => {
  assert.equal(streamLevel(heard('b', { lossPct: 10 })), 'good');
  const brief = counts(0.4, BROKEN);
  assert.equal(streamLevel({ latest: brief, window: brief }), null, 'under half a second of speech');
  assert.deepEqual(verdicts([report('a', [heard('b', { lossPct: 10 })]), report('b', [heard('a')])]), {
    a: good,
    b: good
  });
});

test('one click is not a trend, but a dropout in the latest poll shows at once', () => {
  assert.equal(streamLevel(heard('b', { concealedPct: 0.4, gapsPerMin: 4 })), 'good');
  assert.equal(
    streamLevel({ latest: counts(3, { concealedPct: 4 }), window: counts(15, { concealedPct: 0.8 }) }),
    'unstable'
  );
});

test('long gaps make speech impossible to follow sooner than short ones', () => {
  assert.equal(streamLevel(heard('b', { concealedPct: 10, gapsPerMin: 100 })), 'bad', '60 ms gaps');
  assert.equal(streamLevel(heard('b', { concealedPct: 16, gapsPerMin: 300 })), 'unstable', '32 ms gaps');
  assert.equal(streamLevel(heard('b', BROKEN)), 'bad');
});

test('a speaker most listeners hear with gaps is the one heard badly', () => {
  assert.deepEqual(
    verdicts([
      report('a', [heard('b', NOISY), heard('c')]),
      report('b', [heard('a'), heard('c')]),
      report('c', [heard('a'), heard('b', NOISY)])
    ]),
    { a: good, b: { level: 'unstable', cause: 'heard_badly' }, c: good }
  );
});

test('a listener who hears most speakers breaking up is the one hearing badly', () => {
  assert.deepEqual(
    verdicts([
      report('a', [heard('b'), heard('c')]),
      report('b', [heard('a'), heard('c')]),
      report('c', [heard('a', BROKEN), heard('b', BROKEN)])
    ]),
    { a: good, b: good, c: { level: 'bad', cause: 'hears_badly' } }
  );
});

test('a pair that sounds bad while both sound fine elsewhere is what that listener hears', () => {
  assert.deepEqual(
    verdicts([
      report('a', [heard('b', NOISY), heard('c')]),
      report('b', [heard('a'), heard('c')]),
      report('c', [heard('a'), heard('b')])
    ]),
    { a: { level: 'unstable', cause: 'hears_badly' }, b: good, c: good }
  );
});

test("between two people the speaker's own line decides whose side the gaps are on", () => {
  const listenerHears = (uplinkLossPct: number) =>
    verdicts([report('a', [heard('b', { ...NOISY, lossPct: 10 })]), report('b', [heard('a')], { uplinkLossPct })]);
  assert.deepEqual(listenerHears(8), { a: good, b: { level: 'unstable', cause: 'heard_badly' } });
  assert.deepEqual(listenerHears(1), { a: { level: 'unstable', cause: 'hears_badly' }, b: good });
});

test('a speaker who sends no reports is still judged by its listeners', () => {
  assert.deepEqual(
    verdicts([report('a', [heard('m', NOISY), heard('c')]), report('c', [heard('a'), heard('m', NOISY)])]),
    { a: good, m: { level: 'unstable', cause: 'heard_badly' }, c: good }
  );
});

test('a long delay is unstable, on the side that adds it, and never bad on its own', () => {
  const far = report('a', [heard('b')], { rttMs: 700 });
  const near = report('b', [heard('a')]);
  assert.equal(mouthToEarMs(far, near), 350 + 15 + 40 + 40);
  assert.equal(mouthToEarMs(undefined, near), null);
  assert.deepEqual(verdicts([far, near]), { a: { level: 'unstable', cause: 'delay' }, b: good });
  assert.deepEqual(verdicts([{ ...far, rttMs: 2000 }, near]), { a: { level: 'unstable', cause: 'delay' }, b: good });
  assert.deepEqual(verdicts([report('a', [heard('b')], { rttMs: 600 }), near]), { a: good, b: good }, 'under 400 ms');
});

test('the worse trouble names the cause, and being heard badly comes before the delay', () => {
  const room = (line: Line) =>
    verdicts([
      report('a', [heard('b'), heard('c')], { rttMs: 700 }),
      report('b', [heard('a', line), heard('c')]),
      report('c', [heard('a', line), heard('b')])
    ]);
  assert.deepEqual(room(NOISY).a, { level: 'unstable', cause: 'heard_badly' });
  assert.deepEqual(room(BROKEN).a, { level: 'bad', cause: 'heard_badly' });
  assert.deepEqual(room({}).a, { level: 'unstable', cause: 'delay' });
});
