import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Runs the real worklet source in a sandbox that stands in for the
// AudioWorkletGlobalScope, then drives it with synthetic noise and "speech".
const SOURCE = readFileSync(new URL('../static/audio-gate.worklet.js', import.meta.url), 'utf8');
const SAMPLE_RATE = 48_000;
const QUANTUM = 128;

function loadProcessor(processorOptions) {
  let Processor = null;
  const port = { onmessage: null };
  const sandbox = {
    AudioWorkletProcessor: class {
      constructor() {
        this.port = port;
      }
    },
    Math,
    Number,
    registerProcessor: (_name, ctor) => {
      Processor = ctor;
    },
    sampleRate: SAMPLE_RATE
  };
  vm.runInNewContext(SOURCE, sandbox);
  const processor = new Processor({ processorOptions });
  return {
    post: (data) => port.onmessage({ data }),
    run(amplitude, seconds, { tone = false } = {}) {
      const quanta = Math.round((seconds * SAMPLE_RATE) / QUANTUM);
      let outEnergy = 0;
      let inEnergy = 0;
      let phase = 0;
      for (let q = 0; q < quanta; q += 1) {
        const input = new Float32Array(QUANTUM);
        for (let i = 0; i < QUANTUM; i += 1) {
          phase += 1;
          input[i] = tone
            ? amplitude * Math.sin((2 * Math.PI * 220 * phase) / SAMPLE_RATE)
            : amplitude * (Math.random() * 2 - 1);
        }
        const output = new Float32Array(QUANTUM);
        processor.process([[input]], [[output]]);
        for (let i = 0; i < QUANTUM; i += 1) {
          inEnergy += input[i] * input[i];
          outEnergy += output[i] * output[i];
        }
      }
      return outEnergy / Math.max(inEnergy, 1e-12);
    },
    processor
  };
}

const NOISE = 0.004; // about -48 dBFS of steady room noise
const SPEECH = 0.2; // about -14 dBFS

test('automatic sensitivity closes on steady noise and opens for speech', () => {
  const gate = loadProcessor({ auto: true, threshold: 0.001 });
  gate.run(NOISE, 2);
  const noisePassed = gate.run(NOISE, 1);
  assert.ok(noisePassed < 0.01, `noise should be held down, passed ${noisePassed}`);

  const speechPassed = gate.run(SPEECH, 0.5, { tone: true });
  assert.ok(speechPassed > 0.8, `speech should pass, passed ${speechPassed}`);
});

test('automatic sensitivity follows a louder noise floor instead of staying open', () => {
  const gate = loadProcessor({ auto: true, threshold: 0.001 });
  gate.run(NOISE, 2);
  // A fan switches on: 12 dB more noise. The floor creeps up and the gate
  // closes on it again after a while.
  gate.run(NOISE * 4, 8);
  const louderNoisePassed = gate.run(NOISE * 4, 1);
  assert.ok(louderNoisePassed < 0.05, `louder steady noise should be gated again, passed ${louderNoisePassed}`);
  assert.ok(gate.run(SPEECH, 0.5, { tone: true }) > 0.8);
});

test('push-to-talk opens an automatic gate and a real threshold restores it', () => {
  const gate = loadProcessor({ auto: true, threshold: 0.001 });
  gate.run(NOISE, 2);
  gate.post({ type: 'set-threshold', threshold: 0 });
  assert.ok(gate.run(NOISE, 0.5) > 0.9, 'held key passes everything');
  gate.post({ type: 'set-threshold', threshold: 0.01 });
  gate.run(NOISE, 1);
  assert.ok(gate.run(NOISE, 1) < 0.01, 'released key gates noise again');
});

test('manual mode keeps its fixed threshold and can be switched to automatic', () => {
  const gate = loadProcessor({ threshold: 0.001 }); // -60 dBFS: below the noise
  gate.run(NOISE, 1);
  assert.ok(gate.run(NOISE, 1) > 0.9, 'a threshold under the noise lets it through');
  gate.post({ type: 'set-auto', auto: true });
  gate.run(NOISE, 2);
  assert.ok(gate.run(NOISE, 1) < 0.01, 'automatic mode learns the floor and gates it');
});
