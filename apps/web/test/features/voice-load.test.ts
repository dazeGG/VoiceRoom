// Keeping a call light on the computer: critical CPU pressure relieves the noise
// suppression once, the call's quality account flags a call that went badly,
// and a muted microphone stops processing audio without breaking push-to-talk.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { state } from '../../src/lib/features/room/client/core/state.svelte.ts';
import { createInitialRoomState } from '../../src/lib/features/room/client/model/room-state.ts';
import {
  CPU_CRITICAL_HOLD_MS,
  startCpuPressureWatch,
  stopCpuPressureWatch,
  type PressureObserverConstructor
} from '../../src/lib/features/room/client/services/cpu-pressure.ts';
import {
  finishCallQuality,
  QUALITY_MIN_CALL_MS,
  recordCpuPressure,
  recordNetworkSample,
  recordReconnect,
  startCallQuality
} from '../../src/lib/features/room/client/room/call-quality.ts';
import {
  PROCESSING_RESUME_CHECK_MS,
  PROCESSING_SUSPEND_DELAY_MS,
  syncMicrophoneProcessing
} from '../../src/lib/features/room/client/services/microphone-service.ts';
import { clearLogBuffer, readLogBuffer } from '../../src/lib/shared/log.ts';
import type { MicProcessor } from '../../src/lib/features/room/client/core/types.ts';

const reopenMicrophone = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../src/lib/features/room/client/ui/devices', () => ({ reopenMicrophone }));

beforeEach(() => {
  Object.assign(state, createInitialRoomState());
  vi.useFakeTimers();
  clearLogBuffer();
  reopenMicrophone.mockClear();
});

afterEach(() => {
  stopCpuPressureWatch();
  finishCallQuality();
  vi.useRealTimers();
});

function fakePressureObserver() {
  let callback: ((records: Array<{ state: string }>) => void) | null = null;
  let disconnected = false;
  const Observer = class {
    constructor(next: (records: Array<{ state: string }>) => void) {
      callback = next;
    }
    observe() {
      return Promise.resolve();
    }
    disconnect() {
      disconnected = true;
    }
  } as unknown as PressureObserverConstructor;
  return {
    Observer,
    report: (pressure: string) => callback?.([{ state: pressure }]),
    disconnected: () => disconnected
  };
}

test('critical pressure has to hold before the noise suppression is relieved, and only once a call', () => {
  const pressure = fakePressureObserver();
  const onCritical = vi.fn();
  const states: string[] = [];
  expect(
    startCpuPressureWatch({ onCritical, onState: (next) => states.push(next), PressureObserver: pressure.Observer })
  ).toBe(true);

  pressure.report('critical');
  vi.advanceTimersByTime(CPU_CRITICAL_HOLD_MS - 1000);
  pressure.report('serious');
  vi.advanceTimersByTime(CPU_CRITICAL_HOLD_MS);
  expect(onCritical).not.toHaveBeenCalled();

  pressure.report('critical');
  pressure.report('critical');
  vi.advanceTimersByTime(CPU_CRITICAL_HOLD_MS);
  expect(onCritical).toHaveBeenCalledTimes(1);

  pressure.report('nominal');
  pressure.report('critical');
  vi.advanceTimersByTime(CPU_CRITICAL_HOLD_MS * 2);
  expect(onCritical).toHaveBeenCalledTimes(1);
  expect(states).toEqual(['critical', 'serious', 'critical', 'critical', 'nominal', 'critical']);

  stopCpuPressureWatch();
  expect(pressure.disconnected()).toBe(true);
});

test('stopping the watch cancels a pending relief, and no API means no watch', () => {
  const pressure = fakePressureObserver();
  const onCritical = vi.fn();
  startCpuPressureWatch({ onCritical, PressureObserver: pressure.Observer });
  pressure.report('critical');
  stopCpuPressureWatch();
  vi.advanceTimersByTime(CPU_CRITICAL_HOLD_MS * 2);
  expect(onCritical).not.toHaveBeenCalled();

  expect(startCpuPressureWatch({ onCritical })).toBe(false);
});

test('a good call is logged and nothing is reported', () => {
  startCallQuality(0);
  recordNetworkSample({ inboundLossPct: 0.5, outboundLossPct: 0, jitterMs: 8, rttMs: 40, transport: 'udp' });
  recordNetworkSample({ inboundLossPct: 1.5, outboundLossPct: 0, jitterMs: 12, rttMs: 60, transport: 'udp' });
  const summary = finishCallQuality(QUALITY_MIN_CALL_MS + 1);
  expect(summary?.degraded).toBe(false);
  expect(summary?.context).toMatchObject({
    inboundLossAvgPct: 1,
    inboundLossMaxPct: 1.5,
    jitterAvgMs: 10,
    rttAvgMs: 50,
    rttMaxMs: 60,
    transport: 'udp',
    reconnects: 0,
    cpuPressureMax: 'nominal'
  });
  expect(readLogBuffer().at(-1)).toMatchObject({ level: 'info', ns: 'room:quality', msg: 'call quality' });
  expect(Object.keys(summary!.context).length).toBeLessThanOrEqual(12);
});

test('loss, reconnects or critical CPU mark a call as degraded, short calls never', () => {
  startCallQuality(0);
  recordNetworkSample({ inboundLossPct: 9, outboundLossPct: null, jitterMs: null, rttMs: null, transport: 'relay' });
  recordNetworkSample({ inboundLossPct: null, outboundLossPct: null, jitterMs: null, rttMs: null, transport: 'udp' });
  const lossy = finishCallQuality(QUALITY_MIN_CALL_MS);
  expect(lossy?.degraded).toBe(true);
  expect(lossy?.context.transport).toBe('relay');

  startCallQuality(0);
  recordReconnect();
  recordReconnect();
  expect(finishCallQuality(QUALITY_MIN_CALL_MS)?.degraded).toBe(true);

  startCallQuality(0);
  recordCpuPressure('serious');
  recordCpuPressure('critical');
  recordCpuPressure('fair');
  const cpu = finishCallQuality(QUALITY_MIN_CALL_MS);
  expect(cpu?.context.cpuPressureMax).toBe('critical');
  expect(cpu?.degraded).toBe(true);

  startCallQuality(0);
  recordReconnect();
  recordReconnect();
  expect(finishCallQuality(QUALITY_MIN_CALL_MS - 1)?.degraded).toBe(false);
  expect(finishCallQuality()).toBeNull();
});

test('a rejoin inside the call keeps counting into the same account', () => {
  startCallQuality(0);
  recordReconnect();
  startCallQuality(10_000);
  recordReconnect();
  expect(finishCallQuality(QUALITY_MIN_CALL_MS)?.context.reconnects).toBe(2);
});

// A class instance, like a real AudioContext, so the room state keeps it as
// is instead of wrapping it in a reactive proxy.
class FakeAudioContext {
  state: AudioContextState = 'running';
  suspend = vi.fn(async () => {
    this.state = 'suspended';
  });
  resume = vi.fn(async () => {
    this.state = 'running';
  });
}

function fakeContext() {
  return new FakeAudioContext();
}

function useCapture(context: FakeAudioContext) {
  state.micProcessor = [{ context, type: 'input-gain' } as unknown as MicProcessor];
}

test('a muted microphone stops processing after a few seconds and resumes on unmute', async () => {
  const context = fakeContext();
  useCapture(context);
  state.microphoneMode = 'open';
  state.muted = true;

  syncMicrophoneProcessing();
  vi.advanceTimersByTime(PROCESSING_SUSPEND_DELAY_MS - 1);
  expect(context.suspend).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(context.suspend).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(context.state).toBe('suspended');

  state.muted = false;
  syncMicrophoneProcessing();
  expect(context.resume).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(PROCESSING_RESUME_CHECK_MS);
  expect(context.state).toBe('running');
  expect(reopenMicrophone).not.toHaveBeenCalled();
});

test('a quick unmute cancels the pause, and push-to-talk with the key up never pauses', () => {
  const context = fakeContext();
  useCapture(context);
  state.microphoneMode = 'open';
  state.muted = true;
  syncMicrophoneProcessing();
  vi.advanceTimersByTime(PROCESSING_SUSPEND_DELAY_MS / 2);
  state.muted = false;
  syncMicrophoneProcessing();
  vi.advanceTimersByTime(PROCESSING_SUSPEND_DELAY_MS * 2);
  expect(context.suspend).not.toHaveBeenCalled();
  expect(context.resume).not.toHaveBeenCalled();

  state.microphoneMode = 'push-to-talk';
  state.muted = true;
  syncMicrophoneProcessing();
  vi.advanceTimersByTime(PROCESSING_SUSPEND_DELAY_MS * 2);
  expect(context.suspend).not.toHaveBeenCalled();

  // Deafened, push-to-talk shows as muted, so it may pause.
  state.outputMuted = true;
  syncMicrophoneProcessing();
  vi.advanceTimersByTime(PROCESSING_SUSPEND_DELAY_MS);
  expect(context.suspend).toHaveBeenCalledTimes(1);
});

test('a replaced capture is never paused by the old timer', () => {
  const first = fakeContext();
  useCapture(first);
  state.microphoneMode = 'open';
  state.muted = true;
  syncMicrophoneProcessing();
  const second = fakeContext();
  useCapture(second);
  vi.advanceTimersByTime(PROCESSING_SUSPEND_DELAY_MS);
  expect(first.suspend).not.toHaveBeenCalled();
  expect(second.suspend).not.toHaveBeenCalled();
});

test('a context that does not come back gets a fresh capture', async () => {
  const context = fakeContext();
  useCapture(context);
  state.microphoneMode = 'open';
  state.muted = true;
  syncMicrophoneProcessing();
  vi.advanceTimersByTime(PROCESSING_SUSPEND_DELAY_MS);
  await vi.advanceTimersByTimeAsync(0);
  context.resume.mockImplementation(async () => {});

  state.muted = false;
  syncMicrophoneProcessing();
  await vi.advanceTimersByTimeAsync(PROCESSING_RESUME_CHECK_MS);
  await vi.waitFor(() => expect(reopenMicrophone).toHaveBeenCalledTimes(1));
});
