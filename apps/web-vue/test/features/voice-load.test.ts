// Keeping a call light on the computer: the CPU pressure watch only reports
// the system's state (relief follows the call itself, call-strain.test.ts),
// the call's quality account flags a call that went badly, and a muted
// microphone stops processing audio without breaking push-to-talk.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { state } from '@/features/room/client/core/room-runtime.store';
import { createInitialRoomState } from '@/features/room/client/model/room-state';
import {
  startCpuPressureWatch,
  stopCpuPressureWatch,
  type PressureObserverConstructor
} from '@/features/room/client/services/cpu-pressure';
import {
  finishCallQuality,
  QUALITY_MIN_CALL_MS,
  recordCpuPressure,
  recordMicDrop,
  recordNetworkSample,
  recordPollCounts,
  recordReconnect,
  startCallQuality,
  type PollCounts
} from '@/features/room/client/room/call-quality';
import {
  PROCESSING_RESUME_CHECK_MS,
  PROCESSING_SUSPEND_DELAY_MS,
  syncMicrophoneProcessing
} from '@/features/room/client/services/microphone-service';
import { clearLogBuffer, readLogBuffer } from '@/shared/log';
import type { MicProcessor } from '@/features/room/client/core/types';
import { defined, instanceOf } from '../helpers/assert';
import { FakeMediaStream } from '../helpers/fake-media';

const reopenMicrophone = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/features/room/client/ui/devices', () => ({ reopenMicrophone }));

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
  const Observer: PressureObserverConstructor = class {
    constructor(next: (records: Array<{ state: string }>) => void) {
      callback = next;
    }
    observe() {
      return Promise.resolve();
    }
    disconnect() {
      disconnected = true;
    }
  };
  return {
    Observer,
    report: (pressure: string) => callback?.([{ state: pressure }]),
    disconnected: () => disconnected
  };
}

test('the pressure watch reports every state and relieves nothing itself; no API means no watch', () => {
  const pressure = fakePressureObserver();
  const states: string[] = [];
  expect(startCpuPressureWatch({ onState: (next) => states.push(next), PressureObserver: pressure.Observer })).toBe(
    true
  );

  pressure.report('critical');
  pressure.report('busy');
  pressure.report('fair');
  expect(states).toEqual(['critical', 'fair']);

  stopCpuPressureWatch();
  expect(pressure.disconnected()).toBe(true);
  pressure.report('critical');
  expect(states).toEqual(['critical', 'fair']);

  expect(startCpuPressureWatch({ onState: () => {} })).toBe(false);
});

/** One poll's counters: a second and a half of speech each way unless told otherwise. */
const poll = (counts: Partial<PollCounts> = {}): PollCounts => ({
  inboundPackets: 150,
  inboundLost: 0,
  outboundPackets: 150,
  outboundLost: 0,
  rttSeconds: 0.12,
  rttChecks: 3,
  playedSamples: 144_000,
  concealedSamples: 0,
  ...counts
});

test('a good call is logged with its exact averages and nothing is reported', () => {
  startCallQuality(0);
  recordNetworkSample({ inboundLossPct: 0.5, outboundLossPct: 0, jitterMs: 8, rttMs: 40, transport: 'udp' });
  recordNetworkSample({ inboundLossPct: 1.5, outboundLossPct: 0, jitterMs: 12, rttMs: 60, transport: 'udp' });
  // 3 of 300 packets lost is 1 %, whatever the per-poll windows said; 0.24 s over 6 checks is 40 ms.
  recordPollCounts(poll({ inboundLost: 3 }));
  recordPollCounts(poll());
  const summary = defined(finishCallQuality(QUALITY_MIN_CALL_MS + 1), 'the call quality summary');
  expect(summary.degraded).toBe(false);
  expect(summary.context).toMatchObject({
    inboundLossAvgPct: 1,
    inboundLossMaxPct: 1.5,
    inboundPackets: 300,
    inboundLostPackets: 3,
    jitterAvgMs: 10,
    rttAvgMs: 40,
    rttMaxMs: 60,
    transport: 'udp',
    reconnects: 0,
    cpuPressureMax: 'nominal',
    concealedAvgPct: 0
  });
  expect(readLogBuffer().at(-1)).toMatchObject({ level: 'info', ns: 'room:quality', msg: 'call quality' });
  // The intake keeps eighteen keys of a context (client-log-intake.ts).
  expect(Object.keys(summary.context)).toHaveLength(18);
});

test('averages count every packet and sample of the call, so a silent poll weighs what it carried', () => {
  startCallQuality(0);
  // A long stretch of speech with no loss, then a silent poll with its one lost packet out of eight.
  for (let n = 0; n < 10; n += 1) recordPollCounts(poll());
  recordPollCounts(poll({ inboundPackets: 8, inboundLost: 1 }));
  const stats = defined(finishCallQuality(QUALITY_MIN_CALL_MS), 'the call quality summary').stats;
  // 1 of 1508, not the 12.5 % of that poll averaged in.
  expect(stats.inboundLossAvgPct).toBe(0.1);
  expect(stats.inboundPackets).toBe(1508);

  // Too few packets to tell anything leaves the average empty, not zero.
  startCallQuality(0);
  recordPollCounts(poll({ inboundPackets: 8, inboundLost: 1, outboundPackets: 0, playedSamples: 0 }));
  expect(defined(finishCallQuality(QUALITY_MIN_CALL_MS), 'the call quality summary').stats).toMatchObject({
    inboundLossAvgPct: null,
    outboundLossAvgPct: null,
    concealedAvgPct: null
  });
});

test('audible concealment is counted over the call and its worst 15 seconds', () => {
  startCallQuality(0);
  for (let n = 0; n < 5; n += 1) recordPollCounts(poll());
  // A rough stretch: a fifth of the sound made up over two polls.
  recordPollCounts(poll({ concealedSamples: 28_800 }));
  recordPollCounts(poll({ concealedSamples: 28_800 }));
  for (let n = 0; n < 5; n += 1) recordPollCounts(poll());
  const stats = defined(finishCallQuality(QUALITY_MIN_CALL_MS), 'the call quality summary').stats;
  // 57 600 of 1 728 000 samples over the call; 57 600 of 720 000 over the worst five polls.
  expect(stats.concealedAvgPct).toBe(3.3);
  expect(stats.concealedMaxPct).toBe(8);
});

test("the answer to 'how was the call?' carries the worst moments, the counts and the microphone drops", () => {
  startCallQuality(0);
  recordNetworkSample({ inboundLossPct: 0, outboundLossPct: 1, jitterMs: 6, rttMs: 30, transport: 'udp' });
  recordNetworkSample({ inboundLossPct: 13.3, outboundLossPct: 4, jitterMs: 25, rttMs: 1109, transport: 'udp' });
  recordNetworkSample({ inboundLossPct: null, outboundLossPct: null, jitterMs: null, rttMs: null, transport: null });
  recordPollCounts(poll({ outboundLost: 3 }));
  recordMicDrop();
  recordMicDrop();
  recordCpuPressure('critical');
  const summary = defined(finishCallQuality(QUALITY_MIN_CALL_MS), 'the call quality summary');
  expect(summary.stats).toMatchObject({
    rttMaxMs: 1109,
    inboundLossMaxPct: 13.3,
    outboundLossMaxPct: 4,
    jitterMaxMs: 25,
    cpuPressureMax: 'critical',
    cpuRelieved: false,
    micDrops: 2,
    outboundPackets: 150,
    outboundLostPackets: 3,
    outboundLossAvgPct: 2
  });

  startCallQuality(0);
  const quiet = defined(finishCallQuality(QUALITY_MIN_CALL_MS), 'the call quality summary');
  expect(quiet.stats).toMatchObject({ rttMaxMs: null, inboundLossMaxPct: null, jitterMaxMs: null, micDrops: 0 });
});

test('loss, audible concealment or reconnects mark a call as degraded; a busy computer alone or a short call never', () => {
  startCallQuality(0);
  recordNetworkSample({ inboundLossPct: 9, outboundLossPct: null, jitterMs: null, rttMs: null, transport: 'relay' });
  recordPollCounts(poll({ inboundLost: 15 }));
  const lossy = finishCallQuality(QUALITY_MIN_CALL_MS);
  expect(lossy?.degraded).toBe(true);
  expect(lossy?.context.transport).toBe('relay');

  startCallQuality(0);
  recordPollCounts(poll({ concealedSamples: 7_200 }));
  expect(finishCallQuality(QUALITY_MIN_CALL_MS)?.degraded).toBe(true);

  startCallQuality(0);
  recordReconnect();
  recordReconnect();
  expect(finishCallQuality(QUALITY_MIN_CALL_MS)?.degraded).toBe(true);

  // A game keeps the CPU critical through a call that sounds fine.
  startCallQuality(0);
  recordCpuPressure('serious');
  recordCpuPressure('critical');
  recordCpuPressure('fair');
  recordPollCounts(poll());
  const busy = finishCallQuality(QUALITY_MIN_CALL_MS);
  expect(busy?.context.cpuPressureMax).toBe('critical');
  expect(busy?.degraded).toBe(false);

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
  createGain() {
    return {};
  }
  createMediaStreamDestination() {
    return {};
  }
  createMediaStreamSource() {
    return {};
  }
}

// A microphone captured through a stand-in AudioContext (the code under test
// reads only the context); returns that context to watch suspend and resume.
function useCapture(): FakeAudioContext {
  vi.stubGlobal('AudioContext', FakeAudioContext);
  const context = new AudioContext();
  const processor: MicProcessor = {
    type: 'input-gain',
    context,
    source: context.createMediaStreamSource(new FakeMediaStream()),
    node: context.createGain(),
    destination: context.createMediaStreamDestination(),
    nodes: [],
    setGain: () => {}
  };
  state.micProcessor = [processor];
  return instanceOf(context, FakeAudioContext, 'the capture context');
}

test('a muted microphone stops processing after a few seconds and resumes on unmute', async () => {
  const context = useCapture();
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
  const context = useCapture();
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
  const first = useCapture();
  state.microphoneMode = 'open';
  state.muted = true;
  syncMicrophoneProcessing();
  const second = useCapture();
  vi.advanceTimersByTime(PROCESSING_SUSPEND_DELAY_MS);
  expect(first.suspend).not.toHaveBeenCalled();
  expect(second.suspend).not.toHaveBeenCalled();
});

test('a context that does not come back gets a fresh capture', async () => {
  const context = useCapture();
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
