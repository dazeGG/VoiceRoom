// PCM chunks from the desktop audio helper become float samples; a chunk cut
// mid-sample drops the partial tail instead of misreading it.

import { expect, test } from 'vitest';
import { getDesktopPcmSamples } from '../../src/lib/features/room/client/services/desktop-screen-audio';

test('whole float samples are read, a partial tail and empty chunks give nothing extra', () => {
  const floats = new Float32Array([0.25, -0.5, 1]);
  const bytes = new Uint8Array(floats.buffer);
  expect(Array.from(getDesktopPcmSamples(bytes))).toEqual([0.25, -0.5, 1]);

  const withTail = new Uint8Array(bytes.byteLength + 2);
  withTail.set(bytes);
  expect(Array.from(getDesktopPcmSamples(withTail))).toEqual([0.25, -0.5, 1]);

  expect(getDesktopPcmSamples(null).length).toBe(0);
  expect(getDesktopPcmSamples(new Uint8Array(3)).length).toBe(0);
  expect(Array.from(getDesktopPcmSamples(floats.buffer))).toEqual([0.25, -0.5, 1]);
});

test('a chunk that is a view into a larger buffer reads only its own bytes', () => {
  const backing = new Float32Array([9, 0.5, 0.75, 9]);
  const view = new Uint8Array(backing.buffer, 4, 8);
  expect(Array.from(getDesktopPcmSamples(view))).toEqual([0.5, 0.75]);
});
