import { test } from 'vitest';
import { isRecord } from '@voice-room/shared/guards';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Runs the real worklet source in a sandbox that stands in for the
// AudioWorkletGlobalScope, then drives it with synthetic noise and "speech".
const SOURCE = readFileSync(`${import.meta.dirname}/../public/audio-gate.worklet.js`, 'utf8');
const SAMPLE_RATE = 48_000;
const QUANTUM = 128;

type Processor = { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean; threshold: number };
type ProcessorClass = new (options: { processorOptions: unknown }) => Processor;

function loadProcessor(processorOptions: Record<string, unknown>, name = 'voice-room-noise-gate') {
  const registered = new Map<string, ProcessorClass>();
  const posted: unknown[] = [];
  const port: { onmessage: ((event: { data: unknown }) => void) | null; postMessage(data: unknown): void } = {
    onmessage: null,
    postMessage: (data) => posted.push(data)
  };
  const sandbox = {
    AudioWorkletProcessor: class {
      port = port;
    },
    Math,
    Number,
    registerProcessor: (processorName: string, ctor: ProcessorClass) => {
      registered.set(processorName, ctor);
    },
    sampleRate: SAMPLE_RATE
  };
  vm.runInNewContext(SOURCE, sandbox);
  const Processor = registered.get(name);
  assert.ok(Processor, `${name} is registered`);
  const processor = new Processor({ processorOptions });
  return {
    posted,
    post: (data: unknown) => port.onmessage?.({ data }),
    run(amplitude: number, seconds: number, { tone = false } = {}) {
      return runQuanta(processor, amplitude, seconds, { tone }).energyRatio;
    },
    /** Like run, but reports the output itself: exact zeros and peak. */
    runOutput(amplitude: number, seconds: number, { tone = false } = {}) {
      return runQuanta(processor, amplitude, seconds, { tone });
    },
    processor
  };
}

function runQuanta(processor: Processor, amplitude: number, seconds: number, { tone = false } = {}) {
  const quanta = Math.round((seconds * SAMPLE_RATE) / QUANTUM);
  let outEnergy = 0;
  let inEnergy = 0;
  let phase = 0;
  let zeroQuanta = 0;
  let lastQuantumZero = false;
  for (let q = 0; q < quanta; q += 1) {
    const input = new Float32Array(QUANTUM);
    for (let i = 0; i < QUANTUM; i += 1) {
      phase += 1;
      input[i] = tone
        ? amplitude * Math.sin((2 * Math.PI * 220 * phase) / SAMPLE_RATE)
        : amplitude * (Math.random() * 2 - 1);
    }
    const output = new Float32Array(QUANTUM).fill(Number.NaN);
    processor.process([[input]], [[output]]);
    lastQuantumZero = output.every((value) => value === 0);
    if (lastQuantumZero) zeroQuanta += 1;
    for (let i = 0; i < QUANTUM; i += 1) {
      inEnergy += (input[i] ?? 0) ** 2;
      outEnergy += (output[i] ?? 0) ** 2;
    }
  }
  return { energyRatio: outEnergy / Math.max(inEnergy, 1e-12), lastQuantumZero, quanta, zeroQuanta };
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

const INAUDIBLE = 0.00005; // about -86 dBFS: what RNNoise or a closed gate leaves
const QUIET_SPEECH = 0.003; // about -50 dBFS: whisper-quiet, still audible

test('the silence floor turns an inaudible residue into digital silence after its hold', () => {
  const floor = loadProcessor({}, 'voice-room-silence-floor');
  const held = floor.runOutput(INAUDIBLE, 0.2);
  assert.equal(held.zeroQuanta, 0, 'the hold keeps the first 250 ms as they are');
  const silent = floor.runOutput(INAUDIBLE, 1);
  assert.ok(silent.lastQuantumZero, 'then the output is exact zeros, so Opus DTX can engage');
  assert.ok(silent.zeroQuanta > silent.quanta * 0.9);
});

test('the silence floor never touches audible sound, including its very first block', () => {
  const floor = loadProcessor({}, 'voice-room-silence-floor');
  floor.runOutput(INAUDIBLE, 1);
  const speech = floor.runOutput(SPEECH, 0.3, { tone: true });
  assert.equal(speech.zeroQuanta, 0, 'speech after silence passes from its first block');
  assert.ok(Math.abs(speech.energyRatio - 1) < 1e-9, 'and passes unchanged');
  const whisper = floor.runOutput(QUIET_SPEECH, 1);
  assert.equal(whisper.zeroQuanta, 0, 'a quiet but audible signal is never cut');
  assert.ok(Math.abs(whisper.energyRatio - 1) < 1e-9);
});

const speakingMessages = (posted: unknown[]) =>
  posted
    .filter(isRecord)
    .filter((message) => message.type === 'speaking')
    .map((message) => message.speaking);

test('the speaking detector reports only when voice starts and stops, after its hold', () => {
  const detector = loadProcessor({ thresholdDb: -50, holdMs: 180 }, 'voice-room-speaking-detector');
  detector.runOutput(INAUDIBLE, 0.5);
  assert.deepEqual(speakingMessages(detector.posted), [], 'silence says nothing');

  detector.runOutput(SPEECH, 0.01, { tone: true });
  assert.deepEqual(speakingMessages(detector.posted), [true], 'voice is reported within the first blocks');
  detector.runOutput(SPEECH, 1, { tone: true });
  assert.deepEqual(speakingMessages(detector.posted), [true], 'and only once while it goes on');

  detector.runOutput(INAUDIBLE, 0.15);
  assert.deepEqual(speakingMessages(detector.posted), [true], 'a pause shorter than the hold keeps it');
  detector.runOutput(INAUDIBLE, 0.1);
  assert.deepEqual(speakingMessages(detector.posted), [true, false], 'then the end is reported once');
  detector.runOutput(INAUDIBLE, 1);
  assert.deepEqual(speakingMessages(detector.posted), [true, false]);
});

test('the speaking detector follows a new threshold and reports the level only on request', () => {
  const detector = loadProcessor({ thresholdDb: -50 }, 'voice-room-speaking-detector');
  detector.runOutput(QUIET_SPEECH, 0.2, { tone: true }); // about -53 dBFS RMS
  assert.deepEqual(speakingMessages(detector.posted), []);
  detector.post({ type: 'set-threshold', thresholdDb: -60 });
  detector.runOutput(QUIET_SPEECH, 0.05, { tone: true });
  assert.deepEqual(speakingMessages(detector.posted), [true]);

  const levels = () => detector.posted.filter(isRecord).filter((message) => message.type === 'level');
  assert.equal(levels().length, 0);
  detector.post({ type: 'report-level', enabled: true });
  detector.runOutput(QUIET_SPEECH, 0.5, { tone: true });
  assert.ok(levels().length >= 9 && levels().length <= 11, 'about every 50 ms');
  const db = levels().at(-1)?.db;
  assert.ok(typeof db === 'number', 'a level carries its dB');
  assert.ok(db < -50 && db > -56, `level near the signal (${db})`);
  detector.post({ type: 'report-level', enabled: false });
  const count = levels().length;
  detector.runOutput(QUIET_SPEECH, 0.5, { tone: true });
  assert.equal(levels().length, count);
});

test('the silence floor keeps a speech tail for its hold before going silent', () => {
  const floor = loadProcessor({}, 'voice-room-silence-floor');
  floor.runOutput(SPEECH, 0.3, { tone: true });
  const tail = floor.runOutput(INAUDIBLE, 0.2);
  assert.equal(tail.zeroQuanta, 0, 'the 250 ms hold covers a pause between words');
});
