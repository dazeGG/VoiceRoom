// What a call sounds like: speech the receiver had to make up counts, loss the
// repair recovered does not; the room's reports say whose side the trouble is
// on; and a long delay makes a call unstable but never bad.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  concealedSpeechPct,
  judgeVoice,
  mouthToEarMs,
  type HeardStream,
  type VoiceReport
} from '../src/voice-quality.ts';

// Three seconds of speech: 150 packets of 960 samples.
const SPEECH = 150 * 960;
const heard = (senderId: string, concealedPct = 0, lossPct = 0): HeardStream => ({
  senderId,
  packets: 150,
  lost: Math.round((150 * lossPct) / 100),
  concealedSamples: Math.round((SPEECH * concealedPct) / 100)
});
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

test('loss that RED and FEC recovered is not heard, and too little speech says nothing', () => {
  assert.equal(concealedSpeechPct({ packets: 150, concealedSamples: 0 }), 0);
  assert.equal(concealedSpeechPct({ packets: 150, concealedSamples: 14_400 }), 10);
  assert.equal(concealedSpeechPct({ packets: 20, concealedSamples: 19_200 }), null, 'under half a second of speech');

  assert.deepEqual(verdicts([report('a', [heard('b', 0, 10)]), report('b', [heard('a', 0, 10)])]), {
    a: good,
    b: good
  });
  assert.deepEqual(
    verdicts([
      report('a', [{ senderId: 'b', packets: 20, lost: 0, concealedSamples: 19_200 }]),
      report('b', [{ senderId: 'a', packets: 20, lost: 0, concealedSamples: 0 }])
    ]),
    { a: null, b: null }
  );
});

test('a speaker most listeners hear with gaps is the one heard badly', () => {
  assert.deepEqual(
    verdicts([
      report('a', [heard('b', 10), heard('c')]),
      report('b', [heard('a'), heard('c')]),
      report('c', [heard('a'), heard('b', 10)])
    ]),
    { a: good, b: { level: 'unstable', cause: 'heard_badly' }, c: good }
  );
});

test('a listener who hears most speakers breaking up is the one hearing badly', () => {
  assert.deepEqual(
    verdicts([
      report('a', [heard('b'), heard('c')]),
      report('b', [heard('a'), heard('c')]),
      report('c', [heard('a', 20), heard('b', 20)])
    ]),
    { a: good, b: good, c: { level: 'bad', cause: 'hears_badly' } }
  );
});

test('a pair that sounds bad while both sound fine elsewhere is what that listener hears', () => {
  assert.deepEqual(
    verdicts([
      report('a', [heard('b', 5), heard('c')]),
      report('b', [heard('a'), heard('c')]),
      report('c', [heard('a'), heard('b')])
    ]),
    { a: { level: 'unstable', cause: 'hears_badly' }, b: good, c: good }
  );
});

test("between two people the speaker's own line decides whose side the gaps are on", () => {
  const listenerHears = (uplinkLossPct: number) =>
    verdicts([report('a', [heard('b', 5, 10)]), report('b', [heard('a')], { uplinkLossPct })]);
  assert.deepEqual(listenerHears(8), { a: good, b: { level: 'unstable', cause: 'heard_badly' } });
  assert.deepEqual(listenerHears(1), { a: { level: 'unstable', cause: 'hears_badly' }, b: good });
});

test('a speaker who sends no reports is still judged by its listeners', () => {
  assert.deepEqual(verdicts([report('a', [heard('m', 10), heard('c')]), report('c', [heard('a'), heard('m', 10)])]), {
    a: good,
    m: { level: 'unstable', cause: 'heard_badly' },
    c: good
  });
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
  const room = (concealedPct: number) =>
    verdicts([
      report('a', [heard('b'), heard('c')], { rttMs: 700 }),
      report('b', [heard('a', concealedPct), heard('c')]),
      report('c', [heard('a', concealedPct), heard('b')])
    ]);
  assert.deepEqual(room(5).a, { level: 'unstable', cause: 'heard_badly' });
  assert.deepEqual(room(20).a, { level: 'bad', cause: 'heard_badly' });
  assert.deepEqual(room(0).a, { level: 'unstable', cause: 'delay' });
});
