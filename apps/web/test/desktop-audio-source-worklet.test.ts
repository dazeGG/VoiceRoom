import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(`${import.meta.dirname}/../public/desktop-audio-source.worklet.js`, 'utf8');
type Processor = { process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean };
function harness(channels: number, sampleRate: number) {
  let ctor: (new (options: object) => Processor) | undefined;
  const port: { onmessage?: (event: { data: unknown }) => void } = {};
  vm.runInNewContext(source, {
    AudioWorkletProcessor: class {
      port = port;
    },
    Float32Array,
    sampleRate,
    registerProcessor: (_name: string, value: typeof ctor) => {
      ctor = value;
    }
  });
  if (!ctor) throw new Error('processor not registered');
  const processor = new ctor({ processorOptions: { channels } });
  return {
    post: (samples: number[]) => port.onmessage?.({ data: { type: 'samples', samples: new Float32Array(samples) } }),
    read: (frames: number) => {
      const output = Array.from({ length: channels }, () => new Float32Array(frames));
      processor.process([], [output]);
      return output.map((channel) => Array.from(channel));
    }
  };
}

test('retains only the newest half second, including after partial consumption', () => {
  const audio = harness(2, 8);
  audio.post([1, 11, 2, 12, 3, 13]);
  expect(audio.read(1)).toEqual([[1], [11]]);
  audio.post([4, 14, 5, 15, 6, 16]);
  expect(audio.read(5)).toEqual([
    [3, 4, 5, 6, 0],
    [13, 14, 15, 16, 0]
  ]);
});

test('uses sample rate and channel count for its frame budget', () => {
  const audio = harness(1, 4);
  audio.post([1, 2, 3, 4]);
  expect(audio.read(3)).toEqual([[3, 4, 0]]);
});

test('overflow discards whole old chunks and part of the next, then drains to silence', () => {
  const audio = harness(2, 8);
  audio.post([1, 11]);
  audio.post([2, 12, 3, 13]);
  audio.post([4, 14, 5, 15, 6, 16]);
  expect(audio.read(5)).toEqual([
    [3, 4, 5, 6, 0],
    [13, 14, 15, 16, 0]
  ]);
  audio.post([7, 17, 8, 18]);
  expect(audio.read(3)).toEqual([
    [7, 8, 0],
    [17, 18, 0]
  ]);
});
