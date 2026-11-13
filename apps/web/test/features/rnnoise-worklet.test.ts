import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'vitest';

const workletPath = join(dirname(fileURLToPath(import.meta.url)), '../../public/rnnoise/rnnoise.worklet.js');
const wasmPath = join(dirname(fileURLToPath(import.meta.url)), '../../public/rnnoise/rnnoise.wasm');
const oldWorkletPath = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/rnnoise-old.worklet.js.txt');

class StubProcessor {
  port = { onmessage: (_message: { data: boolean | string }) => {}, postMessage: (_value: object) => {} };
}

function createProcessor(
  path = workletPath,
  module: WebAssembly.Module | object = {},
  wasm: typeof WebAssembly | { Instance: new (module: object) => { exports: object } } = stubWasm()
) {
  type ProcessorClass = new (options: object) => {
    process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
    port: { onmessage: (message: { data: boolean | string }) => void };
  };
  const registration: { processorClass?: ProcessorClass } = {};
  runInNewContext(readFileSync(path, 'utf8'), {
    AudioWorkletProcessor: StubProcessor,
    WebAssembly: wasm,
    Float32Array,
    Math,
    Date,
    sampleRate: 48_000,
    registerProcessor: (_name: string, constructor: ProcessorClass) => {
      registration.processorClass = constructor;
    }
  });
  const Processor = registration.processorClass;
  if (!Processor) throw new Error('RNNoise processor did not register');
  return new Processor({ processorOptions: { module } });
}

function stubWasm(noOutput = false) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const exports = {
    memory,
    newState: () => 1,
    deleteState: () => undefined,
    getInput: () => 0,
    getVadProb: () => 0,
    pipe: (_state: number, length: number) => {
      new Float32Array(memory.buffer, 512, length).fill(0.25);
      return noOutput ? 0 : 512;
    }
  };
  return {
    Instance: class {
      exports = exports;
    }
  };
}

test('RNNoise processor keeps empty input silent and resumes on the next valid quantum', () => {
  const processor = createProcessor();
  const valid = new Float32Array(128);
  const output = new Float32Array(128);
  assert.equal(processor.process([[valid]], [[output]]), true);
  assert.equal(output[0], 0.25);
  output.fill(1);
  assert.equal(processor.process([[]], [[output]]), true);
  assert.ok(output.every((sample) => sample === 0));
  assert.equal(processor.process([], [[output]]), true);
  assert.ok(output.every((sample) => sample === 0));
  assert.equal(processor.process([[valid]], [[output]]), true);
  assert.equal(output[0], 0.25);
  processor.port.onmessage({ data: false });
  assert.equal(processor.process([[valid]], [[output]]), false);
});

test('new worklet accepts every absent bus/channel and clears reused output', () => {
  const processor = createProcessor();
  const output = new Float32Array(128).fill(1);
  for (const input of [[], [[]], [[new Float32Array(0)]]]) {
    output.fill(1);
    assert.equal(processor.process(input, [[output]]), true);
    assert.ok(output.every((sample) => sample === 0));
  }
  assert.equal(processor.process([[new Float32Array(128)]], []), true);
  assert.equal(processor.process([[new Float32Array(128)]], [[]]), true);
  const shortOutput = new Float32Array(64).fill(1);
  assert.equal(processor.process([[new Float32Array(64)]], [[shortOutput]]), true);
  assert.ok(shortOutput.every((sample) => sample === 0));
});

test('WASM pipe with no produced block cannot expose a reused output', () => {
  const processor = createProcessor(workletPath, {}, stubWasm(true));
  const output = new Float32Array(128).fill(1);
  assert.equal(processor.process([[new Float32Array(128)]], [[output]]), true);
  assert.ok(output.every((sample) => sample === 0));
});

test('old and new worklets share the pinned WASM ABI; only new bytes fix empty input', () => {
  const module = new WebAssembly.Module(readFileSync(wasmPath));
  const exports = WebAssembly.Module.exports(module).map((entry) => entry.name);
  for (const required of ['memory', 'newState', 'deleteState', 'getInput', 'getVadProb', 'pipe']) {
    assert.ok(exports.includes(required));
  }
  // The module stands in for a compiled instance retained by an old tab while
  // a newly created context fetches either version of the fixed-path worklet.
  for (const path of [oldWorkletPath, workletPath]) {
    const processor = createProcessor(path, module, WebAssembly);
    const input = new Float32Array(128);
    const output = new Float32Array(128);
    assert.equal(processor.process([[input]], [[output]]), true);
    if (path === oldWorkletPath) {
      assert.throws(() => processor.process([[]], [[output]]), /Cannot convert undefined or null to object/);
    } else {
      output.fill(1);
      assert.equal(processor.process([[]], [[output]]), true);
      assert.ok(output.every((sample) => sample === 0));
      assert.equal(processor.process([[input]], [[output]]), true);
    }
    processor.port.onmessage({ data: false });
    assert.equal(processor.process([[input]], [[output]]), false);
  }
});
