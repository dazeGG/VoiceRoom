// PCM chunks from the desktop audio helper become float samples; a chunk cut
// mid-sample drops the partial tail instead of misreading it. Mid-stream helper
// restarts stay silent; a final non-zero exit reports the stream audio as lost.

import { afterEach, expect, test, vi } from 'vitest';
import { state } from '@/features/room/client/core/room-runtime.store';
import {
  getDesktopPcmSamples,
  onDesktopScreenAudioLost,
  startDesktopSafeScreenAudioCapture,
  stopLocalScreenAudioCapture
} from '@/features/room/client/services/desktop-screen-audio';

type BridgeEvent = { sessionId: string; event: Record<string, unknown> };

function installDesktopAudioBridge({ withTrack = true }: { withTrack?: boolean } = {}) {
  const released = { dataListener: false, context: false };
  const eventListeners = new Set<(payload: BridgeEvent) => void>();
  const emit = (event: Record<string, unknown>) => {
    for (const listener of [...eventListeners]) listener({ event, sessionId: '7' });
  };
  const bridge = {
    onData: () => () => {
      released.dataListener = true;
    },
    onEvent: (listener: (payload: BridgeEvent) => void) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    startSafeSystem: vi.fn(async () => {
      queueMicrotask(() => emit({ channels: 2, event: 'format', sampleRate: 48000 }));
      return { sessionId: '7' };
    }),
    stop: vi.fn(async () => {})
  };
  vi.stubGlobal('voiceRoomDesktopAudio', bridge);

  const track = { addEventListener() {}, contentHint: '', removeEventListener() {} };
  class FakeAudioContext {
    audioWorklet = { addModule: async () => {} };
    close = async () => {
      released.context = true;
    };
    createMediaStreamDestination() {
      return { disconnect() {}, stream: { getAudioTracks: () => (withTrack ? [track] : []) } };
    }
  }
  class FakeAudioWorkletNode {
    port = { postMessage() {} };
    connect() {}
    disconnect() {}
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
  return { bridge, emit, eventListeners, released };
}

afterEach(() => {
  stopLocalScreenAudioCapture();
  vi.unstubAllGlobals();
});

test('a helper restart keeps the stream audio; a final failed exit reports it lost', async () => {
  const { emit } = installDesktopAudioBridge();
  const lost = vi.fn();
  const unsubscribe = onDesktopScreenAudioLost(lost);
  state.localScreenAudioCapture = await startDesktopSafeScreenAudioCapture();

  emit({ attempt: 1, delayMs: 0, event: 'restarting' });
  emit({ channels: 2, event: 'format', sampleRate: 48000 });
  expect(lost).not.toHaveBeenCalled();
  expect(state.localScreenAudioCapture?.sessionId).toBe('7');

  emit({ code: 3, event: 'exit', signal: null });
  expect(lost).toHaveBeenCalledTimes(1);
  unsubscribe();
});

test('a clean exit or an exit after the share stopped is not a loss', async () => {
  const { emit, eventListeners } = installDesktopAudioBridge();
  const lost = vi.fn();
  const unsubscribe = onDesktopScreenAudioLost(lost);
  state.localScreenAudioCapture = await startDesktopSafeScreenAudioCapture();

  emit({ code: 0, event: 'exit', signal: null });
  expect(lost).not.toHaveBeenCalled();

  stopLocalScreenAudioCapture();
  expect(eventListeners.size).toBe(0);
  emit({ code: 3, event: 'exit', signal: null });
  expect(lost).not.toHaveBeenCalled();
  unsubscribe();
});

test('a destination without a track fails the capture and releases what it opened', async () => {
  const { bridge, eventListeners, released } = installDesktopAudioBridge({ withTrack: false });

  await expect(startDesktopSafeScreenAudioCapture()).rejects.toThrow('desktop audio destination has no track');
  expect(released).toEqual({ dataListener: true, context: true });
  expect(eventListeners.size).toBe(0);
  expect(bridge.stop).toHaveBeenCalled();
});

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
