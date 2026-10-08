import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Runs the real worklet source in a sandbox that stands in for the
// AudioWorkletGlobalScope, then drives it with synthetic noise and "speech".
const SOURCE = readFileSync(`${import.meta.dirname}/../static/audio-gate.worklet.js`, 'utf8');
const SAMPLE_RATE = 48_000;
const QUANTUM = 128;

type Processor = { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean; threshold: number };
type ProcessorClass = new (options: { processorOptions: unknown }) => Processor;

function loadProcessor(processorOptions: Record<string, unknown>) {
  const registered: { Processor?: ProcessorClass } = {};
  const port: { onmessage: ((event: { data: unknown }) => void) | null } = { onmessage: null };
  const sandbox = {
    AudioWorkletProcessor: class {
      port = port;
    },
    Math,
    Number,
    registerProcessor: (_name: string, ctor: ProcessorClass) => {
      registered.Processor = ctor;
    },
    sampleRate: SAMPLE_RATE
  };
  vm.runInNewContext(SOURCE, sandbox);
  assert.ok(registered.Processor);
  const processor = new registered.Processor({ processorOptions });
  return {
    post: (data: unknown) => port.onmessage?.({ data }),
    run(amplitude: number, seconds: number, { tone = false } = {}) {
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
          inEnergy += (input[i] ?? 0) ** 2;
          outEnergy += (output[i] ?? 0) ** 2;
        }
      }
      return outEnergy / Math.max(inEnergy, 1e-12);
    },
    processor
  };
}

const NOISE = 0.004; // about -48 dBFS of steady room noise
const SPEECH = 0.2; // about -14 dBFS

test('a fixed threshold keeps steady noise out and lets speech through', () => {
  const gate = loadProcessor({ threshold: 0.02 }); // about -34 dBFS
  assert.ok(gate.run(NOISE, 1) < 0.01, 'noise below the threshold is gated');
  assert.ok(gate.run(SPEECH, 0.5, { tone: true }) > 0.5, 'speech above it passes');
});

test('a zero threshold opens the gate fully and a real one closes it again', () => {
  const gate = loadProcessor({ threshold: 0.02 });
  gate.run(NOISE, 1);
  gate.post({ type: 'set-threshold', threshold: 0 });
  assert.ok(gate.run(NOISE, 0.5) > 0.9, 'push-to-talk lets everything through');
  gate.post({ type: 'set-threshold', threshold: 0.02 });
  gate.run(NOISE, 0.5); // the open gate holds, then releases
  assert.ok(gate.run(NOISE, 1) < 0.01, 'the threshold applies again');
});
