// A microphone can stop reaching its encoder while the connection stays healthy:
// no packet is lost, because none is sent. The stats poll sees the sound fall
// behind the clock and rebuilds the capture, then the media connection; a muted
// microphone, a poll after the computer slept and a browser that does not count
// the sound are not stalls. Each poll tells the server what it saw.

import { afterEach, expect, test, vi } from 'vitest';
import {
  MIC_HEALTHY_POLLS,
  MIC_RECOVERIES_PER_CALL,
  MIC_RECOVERY_TIMEOUT_MS,
  canRecoverMic,
  createMicSendTracker,
  noteMicSend,
  startMicSendWatch,
  stopMicSendWatch,
  takeMicPoll,
  type MicReading
} from '@/features/room/client/room/mic-send';
import { resolveDesktopBoundaryPolicy } from '@/platform/desktop-boundary';
import { freshImport } from '../helpers/fresh-module';
import { defined } from '../helpers/assert';

afterEach(() => {
  stopMicSendWatch();
  vi.useRealTimers();
  vi.doUnmock('@/entities/room/room-realtime');
});

const POLL_MS = 3000;

/** Readings of a capture: each poll `share` of the sound reaches the encoder while its clock keeps `clock` of the time. */
function capture() {
  const reading: MicReading = { atMs: 1_000_000, deliveredSeconds: 100, contextSeconds: 100 };
  return (share: number, clock = 1): MicReading => {
    reading.atMs += POLL_MS;
    reading.deliveredSeconds += (POLL_MS / 1000) * share;
    reading.contextSeconds += (POLL_MS / 1000) * clock;
    return { ...reading };
  };
}

function watch() {
  const reopen = vi.fn(async () => true);
  const replace = vi.fn<() => Promise<boolean> | null>(async () => true);
  const canRecover = vi.fn(() => true);
  startMicSendWatch({ reopen, replace, canRecover });
  return { reopen, replace, canRecover };
}

/** Lets a rebuild that was started finish. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

async function polls(count: number, next: () => MicReading): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    noteMicSend(next());
    await settled();
  }
}

test('a poll says how much sound should have reached the encoder, did, and how far the capture ran', () => {
  const tracker = createMicSendTracker();
  const next = capture();
  expect(tracker.note(next(1)), 'the first reading only sets the baseline').toBeNull();
  expect(tracker.note(next(0.5, 0.9))).toEqual({
    expectedMs: 3000,
    deliveredMs: 1500,
    contextMs: 2700,
    stalled: false
  });
});

test('only a full window of missing sound is a stall', () => {
  const tracker = createMicSendTracker();
  const next = capture();
  tracker.note(next(1));
  const stalls = [0, 0, 0, 0, 0].map(() => tracker.note(next(0))?.stalled);
  expect(stalls).toEqual([false, false, false, false, true]);
});

test('a short blip, however deep, stays under the line of the window', () => {
  const tracker = createMicSendTracker();
  const next = capture();
  tracker.note(next(1));
  // 2.4 of 15 seconds went missing, in one poll: 16 %.
  const stalls = [0.2, 1, 1, 1, 1, 1, 1].map((share) => tracker.note(next(share))?.stalled);
  expect(stalls).not.toContain(true);
});

test('a poll after the computer slept says nothing, and neither does a new capture', () => {
  const tracker = createMicSendTracker();
  const next = capture();
  tracker.note(next(1));
  const slept = next(0);
  expect(tracker.note({ ...slept, atMs: slept.atMs + 600_000 })).toBeNull();
  expect(tracker.note({ atMs: slept.atMs + 603_000, deliveredSeconds: 3, contextSeconds: 3 })).toBeNull();
});

test('a stalled microphone is rebuilt without leaving the call, and only once a full window shows it', async () => {
  const { reopen, replace } = watch();
  const next = capture();
  noteMicSend(next(1));
  await polls(4, () => next(0));
  expect(reopen).not.toHaveBeenCalled();
  await polls(1, () => next(0));
  expect(reopen).toHaveBeenCalledOnce();
  expect(replace).not.toHaveBeenCalled();
});

test('a capture that did not help is followed by a new media connection', async () => {
  const { reopen, replace } = watch();
  const next = capture();
  noteMicSend(next(1));
  await polls(5, () => next(0));
  await polls(5, () => next(0));
  expect(reopen).toHaveBeenCalledOnce();
  expect(replace).toHaveBeenCalledOnce();
});

test('a stall after a healthy minute starts over from the capture', async () => {
  const { reopen, replace } = watch();
  const next = capture();
  noteMicSend(next(1));
  await polls(5, () => next(0));
  await polls(MIC_HEALTHY_POLLS, () => next(1));
  await polls(5, () => next(0));
  expect(reopen).toHaveBeenCalledTimes(2);
  expect(replace).not.toHaveBeenCalled();
});

test('a computer that keeps stalling is not rebuilt forever', async () => {
  const { reopen, replace } = watch();
  const next = capture();
  noteMicSend(next(1));
  await polls(5 * (MIC_RECOVERIES_PER_CALL + 4), () => next(0));
  expect(reopen.mock.calls.length + replace.mock.calls.length).toBe(MIC_RECOVERIES_PER_CALL);
});

test('a rebuild still running is not started again', async () => {
  const { reopen } = watch();
  let finish: (value: boolean) => void = () => {};
  reopen.mockImplementationOnce(() => new Promise<boolean>((resolve) => (finish = resolve)));
  const next = capture();
  noteMicSend(next(1));
  await polls(15, () => next(0));
  expect(reopen).toHaveBeenCalledOnce();
  finish(true);
  await settled();
});

test('a failed rebuild does not stop the watch', async () => {
  const { reopen, replace } = watch();
  reopen.mockRejectedValueOnce(new Error('no microphone'));
  const next = capture();
  noteMicSend(next(1));
  await polls(5, () => next(0));
  await polls(5, () => next(0));
  expect(replace).toHaveBeenCalledOnce();
});

test('a phone holding a background page back is not rebuilt', async () => {
  const { reopen, canRecover } = watch();
  canRecover.mockReturnValue(false);
  const next = capture();
  noteMicSend(next(1));
  await polls(10, () => next(0));
  expect(reopen).not.toHaveBeenCalled();
});

test('a phone that lets the page back gets a full new window before any rebuild', async () => {
  const { reopen, canRecover } = watch();
  canRecover.mockReturnValue(false);
  const next = capture();
  noteMicSend(next(1));
  await polls(10, () => next(0));
  canRecover.mockReturnValue(true);
  await polls(4, () => next(0));
  expect(reopen).not.toHaveBeenCalled();
  await polls(1, () => next(0));
  expect(reopen).toHaveBeenCalledOnce();
});

test('a rebuild that hangs stops holding the way to a new connection', () => {
  vi.useFakeTimers();
  const { reopen, replace } = watch();
  reopen.mockImplementationOnce(() => new Promise<boolean>(() => {}));
  const next = capture();
  noteMicSend(next(1));
  for (let i = 0; i < 10; i += 1) noteMicSend(next(0));
  expect(reopen).toHaveBeenCalledOnce();
  expect(replace, 'still waiting for the rebuild').not.toHaveBeenCalled();
  vi.advanceTimersByTime(MIC_RECOVERY_TIMEOUT_MS);
  for (let i = 0; i < 5; i += 1) noteMicSend(next(0));
  expect(replace).toHaveBeenCalledOnce();
});

test('a replacement that cannot start now costs nothing and reports nothing', async () => {
  const { replace } = watch();
  replace.mockReturnValue(null);
  const next = capture();
  noteMicSend(next(1));
  await polls(5, () => next(0));
  takeMicPoll();
  await polls(5 * (MIC_RECOVERIES_PER_CALL + 2), () => next(0));
  expect(replace).toHaveBeenCalledTimes(MIC_RECOVERIES_PER_CALL + 2);
  expect(takeMicPoll()).toMatchObject({ reopens: 0, replacements: 0 });
  replace.mockResolvedValue(true);
  await polls(5, () => next(0));
  expect(takeMicPoll()).toMatchObject({ reopens: 0, replacements: 1 });
});

test('a replacement that gave way to the standing connection is not reported as done', async () => {
  const { replace } = watch();
  replace.mockResolvedValue(false);
  const next = capture();
  noteMicSend(next(1));
  await polls(5, () => next(0));
  takeMicPoll();
  await polls(5, () => next(0));
  expect(replace).toHaveBeenCalledOnce();
  expect(takeMicPoll()).toMatchObject({ replacements: 0 });
});

test('a replacement still running is not asked for again', async () => {
  const { replace } = watch();
  replace.mockImplementationOnce(() => new Promise<boolean>(() => {}));
  const next = capture();
  noteMicSend(next(1));
  await polls(25, () => next(0));
  expect(replace).toHaveBeenCalledOnce();
});

test('muting starts the count over: the silence of a mute is no stall', async () => {
  const { reopen } = watch();
  const next = capture();
  noteMicSend(next(1));
  await polls(4, () => next(0));
  noteMicSend(null);
  await polls(4, () => next(0));
  expect(reopen).not.toHaveBeenCalled();
});

test('a poll reports once what it saw and the recoveries since the last report', async () => {
  watch();
  const next = capture();
  noteMicSend(next(1));
  expect(takeMicPoll(), 'a baseline has nothing to say').toBeNull();
  noteMicSend(next(1));
  expect(takeMicPoll()).toEqual({ expectedMs: 3000, deliveredMs: 3000, contextMs: 3000, reopens: 0, replacements: 0 });
  expect(takeMicPoll(), 'told once').toBeNull();
  await polls(5, () => next(0));
  expect(takeMicPoll()).toEqual({ expectedMs: 3000, deliveredMs: 0, contextMs: 3000, reopens: 1, replacements: 0 });
  noteMicSend(null);
  expect(takeMicPoll()).toBeNull();
});

test('a recovery followed by a mute still reaches the server', async () => {
  watch();
  const next = capture();
  noteMicSend(next(1));
  await polls(5, () => next(0));
  noteMicSend(null);
  expect(takeMicPoll()).toEqual({ expectedMs: 0, deliveredMs: 0, contextMs: 0, reopens: 1, replacements: 0 });
});

type StatsEntry = { id: string } & Record<string, unknown>;
const report = (entries: StatsEntry[]) => ({
  forEach: (callback: (value: unknown) => void) => entries.forEach((entry) => callback(entry))
});

/** A joined call whose microphone's sender reports `source()`, polled by the real stats module. */
async function pollingCall(source: () => StatsEntry[], overrides: Record<string, unknown> = {}) {
  vi.useFakeTimers();
  const sent: Array<{ mic?: unknown }> = [];
  vi.doMock('@/entities/room/room-realtime', () => ({
    updateVoicePeer: () => {},
    reportVoicePoll: (payload: { mic?: unknown }) => sent.push(payload)
  }));
  const stats = await freshImport(() => import('@/features/room/client/room/stats'));
  const micSend = await import('@/features/room/client/room/mic-send');
  const { state } = await import('@/features/room/client/core/room-runtime.store');
  Object.assign(state, {
    joined: true,
    voiceConnection: 'connected',
    muted: false,
    localMicPublication: { track: { getRTCStatsReport: async () => report(source()) } },
    micProcessor: [{ context: { state: 'running', currentTime: 50 } }],
    peers: new Map<string, never>(),
    ...overrides
  });
  const reopen = vi.fn(async () => true);
  micSend.startMicSendWatch({ reopen, replace: () => null, canRecover: () => true });
  stats.startPeerLatencyStats();
  await vi.advanceTimersByTimeAsync(0);
  const run = async (count: number) => {
    for (let i = 0; i < count; i += 1) await vi.advanceTimersByTimeAsync(POLL_MS);
  };
  const stop = () => {
    stats.stopPeerLatencyStats();
    micSend.stopMicSendWatch();
  };
  return { sent, reopen, run, stop };
}

const counting = (duration: () => number) => () => [
  { id: 'src', type: 'media-source', kind: 'audio', totalSamplesDuration: duration(), timestamp: Date.now() }
];

test('the stats poll rebuilds a microphone whose count stopped, and tells the server', async () => {
  const { sent, reopen, run, stop } = await pollingCall(counting(() => 42));
  await run(5);
  stop();
  expect(reopen).toHaveBeenCalledOnce();
  expect(sent.at(-1)?.mic).toMatchObject({ deliveredMs: 0, reopens: 1 });
});

test('a poll of a healthy microphone reports its sound and rebuilds nothing', async () => {
  let delivered = 1;
  const { sent, reopen, run, stop } = await pollingCall(
    counting(() => {
      delivered += POLL_MS / 1000;
      return delivered;
    })
  );
  await run(6);
  stop();
  expect(reopen).not.toHaveBeenCalled();
  expect(defined(sent.at(-1), 'the last poll').mic).toMatchObject({
    expectedMs: POLL_MS,
    deliveredMs: POLL_MS,
    reopens: 0
  });
});

test('a browser that does not count the sound is never taken for a stalled microphone', async () => {
  for (const source of [
    counting(() => 0),
    () => [{ id: 'src', type: 'media-source', kind: 'audio', timestamp: Date.now() }]
  ]) {
    const { sent, reopen, run, stop } = await pollingCall(source);
    await run(8);
    stop();
    expect(reopen).not.toHaveBeenCalled();
    expect(sent.every((poll) => poll.mic === undefined)).toBe(true);
  }
});

test('nothing is judged while the media connection is not up', async () => {
  const { reopen, run, stop } = await pollingCall(
    counting(() => 42),
    { voiceConnection: 'reconnecting' }
  );
  await run(8);
  stop();
  expect(reopen).not.toHaveBeenCalled();
});

test('a muted microphone, whose capture is suspended on purpose, is not judged', async () => {
  const { reopen, run, stop } = await pollingCall(
    counting(() => 42),
    { muted: true }
  );
  await run(8);
  stop();
  expect(reopen).not.toHaveBeenCalled();
});

test('a push-to-talk key up is no mute: the capture keeps running, so a count that stopped is a stall', async () => {
  const { reopen, run, stop } = await pollingCall(
    counting(() => 42),
    { muted: true, microphoneMode: 'push-to-talk' }
  );
  await run(5);
  stop();
  expect(reopen).toHaveBeenCalledOnce();
});

test('deafening mutes a push-to-talk microphone for real, and its capture is not judged', async () => {
  const { reopen, run, stop } = await pollingCall(
    counting(() => 42),
    { muted: true, microphoneMode: 'push-to-talk', outputMuted: true }
  );
  await run(8);
  stop();
  expect(reopen).not.toHaveBeenCalled();
});

test('a sender left without its track has no source to report: that is a stall, not a browser that does not count', async () => {
  let delivered = 1;
  let trackless = false;
  const clock = { id: 'out', type: 'outbound-rtp', kind: 'audio' };
  const { sent, reopen, run, stop } = await pollingCall(() => {
    if (trackless) return [{ ...clock, timestamp: Date.now() }];
    delivered += POLL_MS / 1000;
    return counting(() => delivered)();
  });
  await run(2);
  expect(reopen).not.toHaveBeenCalled();
  trackless = true;
  await run(5);
  stop();
  expect(reopen).toHaveBeenCalledOnce();
  expect(sent.at(-1)?.mic).toMatchObject({ deliveredMs: 0, expectedMs: POLL_MS });
});

test('a count that fell to zero after it ran is a stall too', async () => {
  let delivered = 1;
  let stopped = false;
  const { reopen, run, stop } = await pollingCall(
    counting(() => {
      if (stopped) return 0;
      delivered += POLL_MS / 1000;
      return delivered;
    })
  );
  await run(2);
  stopped = true;
  await run(5);
  stop();
  expect(reopen).toHaveBeenCalledOnce();
});

test('only Chromium is rebuilt, and a phone only while the page is in front', () => {
  const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get');
  const hidden = vi.spyOn(document, 'hidden', 'get');
  const allowed = (agent: string, inBackground: boolean) => {
    userAgent.mockReturnValue(agent);
    hidden.mockReturnValue(inBackground);
    resolveDesktopBoundaryPolicy();
    return canRecoverMic();
  };
  const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8)';
  try {
    expect(allowed(`${windows} AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36`, false)).toBe(true);
    expect(allowed(`${windows} AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36`, true)).toBe(true);
    expect(allowed(`${windows} VoiceRoom/2.12.5 Chrome/144.0.0.0 Electron/44.7.1 Safari/537.36`, true)).toBe(true);
    expect(allowed(`${android} AppleWebKit/537.36 Chrome/144.0.0.0 Mobile Safari/537.36`, false)).toBe(true);
    expect(allowed(`${android} AppleWebKit/537.36 Chrome/144.0.0.0 Mobile Safari/537.36`, true)).toBe(false);
    expect(allowed(`${windows} Gecko/20100101 Firefox/140.0`, false)).toBe(false);
    expect(
      allowed(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
        false
      )
    ).toBe(false);
  } finally {
    userAgent.mockRestore();
    hidden.mockRestore();
    resolveDesktopBoundaryPolicy();
  }
});
