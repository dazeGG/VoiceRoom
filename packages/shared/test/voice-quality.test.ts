// What a call sounds like: speech the receiver had to make up counts, loss the
// repair recovered does not; frequent gaps sound broken and long ones make
// speech impossible to follow, as a listener rated the loss bench; the room's
// reports say whose side the trouble is on; and a long delay makes a call
// unstable but never bad.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  averageGapMs,
  concealedSpeechPct,
  gapsPerSpeechMin,
  heardGaps,
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
const NO_SPEECH: HeardCounts = { packets: 0, lost: 0, concealedSamples: 0, gaps: 0 };
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
    streamLevel({ latest: counts(3, { concealedPct: 6 }), window: counts(15, { concealedPct: 1.2 }) }),
    'unstable',
    '180 ms lost out of 3 seconds'
  );
});

test('a sliver of concealment is not a dropout, however short the speech around it', () => {
  // One 24 ms gap in the half second of speech a poll caught: 4.8 % of it, and nothing anyone could follow.
  const sliver: HeardCounts = { packets: 25, lost: 0, concealedSamples: 1152, gaps: 1 };
  assert.equal(streamLevel({ latest: sliver, window: sliver }), null);
  // 120 ms in 3 seconds is over the share, under WebRTC's own 150 ms for an interruption.
  assert.equal(
    streamLevel({ latest: counts(3, { concealedPct: 4 }), window: counts(15, { concealedPct: 0.8 }) }),
    'good'
  );
  // A real dropout counts even in a phrase too short to judge the window by.
  const phrase: HeardCounts = { packets: 100, lost: 0, concealedSamples: 14_400, gaps: 1 };
  assert.equal(streamLevel({ latest: phrase, window: phrase }), 'unstable', '300 ms lost out of 2 seconds');
});

test('two clicks in a window are not a rate: three gaps are the fewest a 15 second window can call one', () => {
  // Ten seconds of speech: two gaps read as 12 a minute, three as 18. A line the bench rated clean makes the first by chance.
  const speech = (gaps: number): HeardCounts => ({ packets: 500, lost: 0, concealedSamples: gaps * 1440, gaps });
  assert.equal(streamLevel({ latest: speech(0), window: speech(2) }), 'good');
  assert.equal(streamLevel({ latest: speech(0), window: speech(3) }), 'unstable');
});

test('dropouts that keep coming are unstable though too few to be a rate and each over by the next poll', () => {
  // 300 ms every ten seconds of speech: two in a window of 15 seconds, 4 % of it, a word gone each time.
  const window: HeardCounts = { packets: 750, lost: 0, concealedSamples: 28_800, gaps: 2 };
  const quiet: HeardCounts = { packets: 150, lost: 0, concealedSamples: 0, gaps: 0 };
  assert.equal(streamLevel({ latest: quiet, window }), 'unstable');
  // Just under what is noticeable: a line the bench rated clean never comes close.
  assert.equal(streamLevel({ latest: quiet, window: { ...window, concealedSamples: 20_000 } }), 'good');
});

test('too little speech in a window says nothing of how it sounds', () => {
  // A DTX stream sends a packet every 400 ms: five polls of silence are 37 packets, under a second of "speech".
  const silence: HeardCounts = { packets: 37, lost: 0, concealedSamples: 1440, gaps: 3 };
  assert.equal(streamLevel({ latest: NO_SPEECH, window: silence }), null);
  const under: HeardCounts = { packets: 149, lost: 0, concealedSamples: 4320, gaps: 3 };
  assert.equal(streamLevel({ latest: NO_SPEECH, window: under }), null, 'just under three seconds');
  assert.equal(streamLevel({ latest: NO_SPEECH, window: { ...under, packets: 150 } }), 'unstable', 'three seconds');
  assert.equal(concealedSpeechPct(under), null);
  assert.equal(gapsPerSpeechMin(under), null);
});

test('only gaps that made up some voice count: WebRTC also counts the ones it filled with silence', () => {
  assert.equal(heardGaps({ gaps: 40, concealedSamples: 0 }), 0, 'all of it silence');
  assert.equal(heardGaps({ gaps: 40, concealedSamples: 479 }), 0, 'under one 10 ms frame of voice');
  assert.equal(heardGaps({ gaps: 40, concealedSamples: 4800 }), 10, 'ten frames can be ten gaps at most');
  assert.equal(heardGaps({ gaps: 3, concealedSamples: 4800 }), 3, 'real gaps are left alone');

  // A minute's worth of silent gaps over 15 seconds of clean speech reads clean, and at the true rate.
  const quiet: HeardCounts = { packets: 750, lost: 0, concealedSamples: 0, gaps: 30 };
  assert.equal(gapsPerSpeechMin(quiet), 0);
  assert.equal(streamLevel({ latest: quiet, window: quiet }), 'good');
  // Silent gaps do not water down how long the real ones were.
  assert.equal(
    averageGapMs({ packets: 750, lost: 0, concealedSamples: 4800, gaps: 500 }),
    10,
    '100 ms made up cannot be 500 gaps'
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
