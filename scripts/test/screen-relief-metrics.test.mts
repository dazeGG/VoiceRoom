import assert from 'node:assert/strict';
import test from 'node:test';
import { cpuMillisecondsPerSecond, evaluateRelief, type ReliefPhase } from '../voice-bench/screen-relief-metrics.mts';

function phases(): ReliefPhase[] {
  return [false, true, true, false].map((relieved) => ({
    relieved,
    cpuMsPerSecond: relieved ? 250 : 400,
    transition: relieved ? { sameTrack: true, audioSamples: 144000, audioEnergy: 3, concealedSamples: 0 } : null,
    samples: Array.from({ length: 20 }, (_, i) => ({
      elapsedMs: (i + 1) * 1000,
      captureFps: relieved ? 15 : 30,
      encodedFps: relieved ? 15 : 30,
      renderedFps: relieved ? 15 : 30,
      width: 1280,
      height: 720,
      audioSamples: 48000,
      audioEnergy: 1,
      concealedSamples: 0,
      encodeMsPerSecond: 20,
      codec: 'video/VP8',
      encoder: 'libvpx'
    }))
  }));
}

test('relief needs complete ABBA actual work and continuous audio, not requested settings', () => {
  assert.deepEqual(evaluateRelief(phases()), { workAndVoice: 'pass', cpuImprovement: 'pass', complete: true });
  assert.equal(evaluateRelief(phases().slice(0, 3)).workAndVoice, 'inconclusive');
  for (const field of ['captureFps', 'encodedFps', 'renderedFps'] as const) {
    const data = phases();
    const sample = data[1]?.samples[0];
    assert.ok(sample);
    sample[field] = 30;
    assert.equal(evaluateRelief(data).workAndVoice, 'fail');
    sample[field] = null;
    assert.equal(evaluateRelief(data).workAndVoice, 'inconclusive');
  }
  for (const field of ['width', 'audioSamples', 'audioEnergy'] as const) {
    const data = phases();
    const sample = data[1]?.samples[0];
    assert.ok(sample);
    sample[field] = 0;
    assert.equal(evaluateRelief(data).workAndVoice, 'fail');
  }
  const data = phases();
  const sample = data[1]?.samples[0];
  assert.ok(sample);
  sample.concealedSamples = 1;
  assert.equal(evaluateRelief(data).workAndVoice, 'fail');
});

test('CPU improvement requires both repetitions below both baselines by at least ten percent', () => {
  const data = phases();
  const phase = data[1];
  assert.ok(phase);
  phase.cpuMsPerSecond = 390;
  assert.equal(evaluateRelief(data).cpuImprovement, 'not-demonstrated');
  phase.cpuMsPerSecond = null;
  assert.equal(evaluateRelief(data).cpuImprovement, 'inconclusive');
  const changedEncoder = phases();
  const sample = changedEncoder[1]?.samples[0];
  assert.ok(sample);
  sample.encoder = 'different encoder';
  assert.equal(evaluateRelief(changedEncoder).cpuImprovement, 'inconclusive');
  sample.codec = null;
  assert.equal(evaluateRelief(changedEncoder).workAndVoice, 'inconclusive');
});

test('relief on a flowing publication must preserve its track and audio during the transition', () => {
  const data = phases();
  const phase = data[1];
  assert.ok(phase?.transition);
  phase.transition.sameTrack = false;
  assert.equal(evaluateRelief(data).workAndVoice, 'fail');
  phase.transition.sameTrack = true;
  phase.transition.concealedSamples = 1;
  assert.equal(evaluateRelief(data).workAndVoice, 'fail');
  phase.transition.concealedSamples = null;
  assert.equal(evaluateRelief(data).workAndVoice, 'inconclusive');
});

test('CPU includes every stable browser process; churn, resets and absent counters stay unknown', () => {
  const before = {
    atMs: 1000,
    processes: [
      { id: 1, type: 'browser', cpuTime: 2 },
      { id: 2, type: 'GPU', cpuTime: 3 }
    ]
  };
  const after = {
    atMs: 3000,
    processes: [
      { id: 1, type: 'browser', cpuTime: 2.1 },
      { id: 2, type: 'GPU', cpuTime: 3.4 }
    ]
  };
  assert.ok(Math.abs((cpuMillisecondsPerSecond(before, after) ?? 0) - 250) < 0.001);
  assert.equal(cpuMillisecondsPerSecond(before, { ...after, processes: after.processes.slice(0, 1) }), null);
  assert.equal(cpuMillisecondsPerSecond(after, before), null);
  assert.equal(cpuMillisecondsPerSecond({ atMs: 0, processes: [] }, after), null);
  assert.equal(cpuMillisecondsPerSecond(after, { ...before, atMs: 4000 }), null);
});
