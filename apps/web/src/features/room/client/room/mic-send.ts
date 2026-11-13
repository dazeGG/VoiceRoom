// Whether the microphone still reaches its encoder. Its sound can stop on the
// way there while the connection stays perfectly healthy: no packet is lost
// because none is sent, no track ends and nothing reconnects, so only the
// listeners notice. The browser counts the audio it hands the encoder
// (media-source totalSamplesDuration); silence, a closed gate and a push-to-talk
// key up all keep that count running, so a count falling behind the clock means
// the sound really stopped.
//
// A full window of it rebuilds the capture without leaving the call, then the
// media connection: leaving and joining again rebuilds both, and it is what
// cured this by hand. Each poll tells the server what it saw (room.voice.report),
// so a stall can be read later: the capture's clock tells a capture that stopped
// from one that ran and gave nothing.

import type { MicPoll } from '@voice-room/shared/contracts/realtime';
import { getDesktopBoundaryPolicy } from '@/platform/desktop-boundary';
import { createLogger, reportClientLogs } from '@/shared/log';
import { LOSS_WINDOW_POLLS, createRatioWindow } from './loss-window';

const log = createLogger('room:mic');

/** The share of the window's sound that never reached the encoder: 3 of about 15 seconds. */
export const MIC_MISSING_STALLED_PCT = 20;
/** A longer gap between two polls is the computer asleep or a frozen tab, which says nothing of the microphone. */
export const MIC_POLL_MAX_GAP_MS = 6_000;
/** Polls without a stall (about a minute) after which a new stall starts over from the capture. */
export const MIC_HEALTHY_POLLS = 20;
/** A computer that keeps stalling is not helped by being rebuilt forever: past this the call only reports it. */
export const MIC_RECOVERIES_PER_CALL = 6;
/** A rebuild that hangs (a stuck device) must not hold the way up the ladder. */
export const MIC_RECOVERY_TIMEOUT_MS = 10_000;
const MIN_WINDOW_MS = 10_000;

/** One reading of the ever-growing counters, in the units the browser gives them. */
export interface MicReading {
  atMs: number;
  /** Zero when the sender has no source or the browser does not count it. */
  deliveredSeconds: number;
  contextSeconds: number;
  /** LiveKit took the track off the sender because the track reported itself muted. */
  upstreamPaused?: boolean;
}

export interface MicSendPoll {
  expectedMs: number;
  deliveredMs: number;
  contextMs: number;
  stalled: boolean;
}

export function createMicSendTracker() {
  const missing = createRatioWindow(MIN_WINDOW_MS);
  let before: MicReading | null = null;
  let polls = 0;

  function resetWindow(): void {
    missing.reset();
    polls = 0;
  }

  /** Adds one reading; answers the poll's share, or null when it only sets a baseline. */
  function note(reading: MicReading): MicSendPoll | null {
    const last = before;
    before = reading;
    if (!last) return null;
    const expectedMs = reading.atMs - last.atMs;
    const deliveredMs = (reading.deliveredSeconds - last.deliveredSeconds) * 1000;
    const contextMs = (reading.contextSeconds - last.contextSeconds) * 1000;
    // A counter that went back is a new capture or sender.
    if (expectedMs <= 0 || expectedMs > MIC_POLL_MAX_GAP_MS || deliveredMs < 0 || contextMs < 0) {
      resetWindow();
      return null;
    }
    const missingPct = missing.add(Math.max(0, expectedMs - deliveredMs), expectedMs);
    polls = Math.min(polls + 1, LOSS_WINDOW_POLLS);
    return {
      expectedMs: Math.round(expectedMs),
      deliveredMs: Math.round(deliveredMs),
      contextMs: Math.round(contextMs),
      stalled: polls >= LOSS_WINDOW_POLLS && missingPct !== null && missingPct >= MIC_MISSING_STALLED_PCT
    };
  }

  function reset(): void {
    before = null;
    resetWindow();
  }

  return { note, reset, resetWindow };
}

export interface MicRecoveryActions {
  /** Builds a new capture under the published microphone. */
  reopen: () => Promise<unknown>;
  /** Replaces the media connection and answers whether it did; null when it cannot start now. */
  replace: () => Promise<boolean> | null;
  /** False while the system may be holding the microphone back on purpose. */
  canRecover: () => boolean;
}

/**
 * Only where the count was measured against a real stall (Chromium, and so the
 * desktop app); elsewhere the numbers are reported and nothing is rebuilt. A phone
 * may hold the microphone of a page in the background, and that is no stall.
 */
export function canRecoverMic(): boolean {
  if (!/\bChrome\//.test(navigator.userAgent)) return false;
  return !document.hidden || getDesktopBoundaryPolicy().platformClass !== 'mobile';
}

// The call's watch: one tracker, the way up the ladder and what the next poll reports.
const tracker = createMicSendTracker();
let progressObservation: {
  before: MicReading | null;
  isCurrent: () => boolean;
  window: ReturnType<typeof createRatioWindow>;
  polls: number;
  finish: (restored: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;

export function observeCaptureProgress(finish: (restored: boolean) => void, isCurrent: () => boolean): void {
  cancelCaptureProgressObservation();
  const timer = setTimeout(() => completeProgressObservation(false), 30_000);
  progressObservation = { before: null, isCurrent, window: createRatioWindow(MIN_WINDOW_MS), polls: 0, finish, timer };
}

function completeProgressObservation(restored: boolean): void {
  const observation = progressObservation;
  if (!observation) return;
  progressObservation = null;
  clearTimeout(observation.timer);
  observation.finish(restored && observation.isCurrent());
}

export function cancelCaptureProgressObservation(): void {
  completeProgressObservation(false);
}

function noteProgressObservation(reading: MicReading | null): void {
  const observation = progressObservation;
  if (!observation) return;
  if (!observation.isCurrent()) {
    completeProgressObservation(false);
    return;
  }
  if (!reading || reading.upstreamPaused) {
    observation.before = null;
    observation.window.reset();
    observation.polls = 0;
    return;
  }
  const before = observation.before;
  observation.before = reading;
  if (!before) return;
  const expected = reading.atMs - before.atMs;
  const delivered = (reading.deliveredSeconds - before.deliveredSeconds) * 1000;
  if (
    expected <= 0 ||
    expected > MIC_POLL_MAX_GAP_MS ||
    delivered < 0 ||
    reading.contextSeconds < before.contextSeconds
  ) {
    observation.window.reset();
    observation.polls = 0;
    return;
  }
  const missing = observation.window.add(Math.max(0, expected - delivered), expected);
  observation.polls += 1;
  if (observation.polls >= LOSS_WINDOW_POLLS && missing !== null && missing < MIC_MISSING_STALLED_PCT)
    completeProgressObservation(true);
}
let actions: MicRecoveryActions | null = null;
let recovering = false;
let recoveryRun = 0;
let lastDeliveredSeconds: number | null = null;
let rebuiltCapture = false;
let healthyPolls = 0;
let recoveries = 0;
let reported: Pick<MicPoll, 'expectedMs' | 'deliveredMs' | 'contextMs'> | null = null;
let reopens = 0;
let replacements = 0;

function clearWatch(): void {
  tracker.reset();
  recovering = false;
  recoveryRun += 1;
  lastDeliveredSeconds = null;
  rebuiltCapture = false;
  healthyPolls = 0;
  recoveries = 0;
  reported = null;
  reopens = 0;
  replacements = 0;
}

/** A new call is judged from nothing. */
export function startMicSendWatch(recoveryActions: MicRecoveryActions): void {
  clearWatch();
  actions = recoveryActions;
}

export function stopMicSendWatch(): void {
  cancelCaptureProgressObservation();
  clearWatch();
  actions = null;
}

/** Holds the ladder until the rebuild is over, or until it can be taken for hung. */
function waitForRecovery(work: Promise<unknown>): void {
  const run = ++recoveryRun;
  recovering = true;
  const finish = () => {
    if (run !== recoveryRun || !recovering) return;
    recovering = false;
    tracker.resetWindow();
  };
  const timer = setTimeout(finish, MIC_RECOVERY_TIMEOUT_MS);
  void work
    .catch((error: unknown) => log.warn('microphone stall recovery failed', { error: String(error) }))
    .finally(() => {
      clearTimeout(timer);
      finish();
    });
}

function recover(poll: MicSendPoll, reading: MicReading): void {
  if (!actions || recovering) return;
  // Judged again from a full window of what happens once it may recover.
  tracker.resetWindow();
  if (!actions.canRecover()) return;
  const context = {
    deliveredMs: poll.deliveredMs,
    contextMs: poll.contextMs,
    expectedMs: poll.expectedMs,
    sourceMissing: reading.deliveredSeconds === 0,
    upstreamPaused: reading.upstreamPaused === true
  };
  healthyPolls = 0;
  if (recoveries >= MIC_RECOVERIES_PER_CALL) {
    log.warn('microphone stalled, no recoveries left', context);
    return;
  }
  if (rebuiltCapture) {
    const replacing = actions.replace();
    // A recovery is already running; a stall that outlives it comes back here.
    if (!replacing) {
      log.warn('microphone stalled, the media connection cannot be replaced now', context);
      return;
    }
    recoveries += 1;
    log.warn('microphone stalled, replacing the media connection', context);
    void reportClientLogs('microphone stalled');
    const watching = actions;
    waitForRecovery(
      replacing.then((replaced) => {
        if (actions !== watching) return;
        if (replaced) replacements += 1;
        else log.warn('microphone stall: the media connection could not be replaced', context);
      })
    );
    return;
  }
  recoveries += 1;
  rebuiltCapture = true;
  reopens += 1;
  log.warn('microphone stalled, rebuilding the capture', context);
  void reportClientLogs('microphone stalled');
  waitForRecovery(actions.reopen());
}

/** The poll's reading; null while the sound is meant to stop (muted, reconnecting). */
export function noteMicSend(reading: MicReading | null): void {
  noteProgressObservation(reading);
  if (!actions) return;
  if (reading && reading.deliveredSeconds > 0) lastDeliveredSeconds = reading.deliveredSeconds;
  // Nothing counted yet in this call: a browser that does not count, or one that has not begun to.
  if (!reading || lastDeliveredSeconds === null) {
    // The count starts over after it.
    tracker.reset();
    reported = null;
    return;
  }
  // Once it has counted, no count means no sound: a sender left without its track has no source to report.
  const poll = tracker.note({ ...reading, deliveredSeconds: lastDeliveredSeconds });
  reported = poll && { expectedMs: poll.expectedMs, deliveredMs: poll.deliveredMs, contextMs: poll.contextMs };
  if (!poll) return;
  if (poll.stalled) {
    recover(poll, reading);
    return;
  }
  healthyPolls += 1;
  if (healthyPolls >= MIC_HEALTHY_POLLS) rebuiltCapture = false;
}

/** What the next stats poll reports of the microphone, once; null when there is nothing to say. */
export function takeMicPoll(): MicPoll | null {
  if (!reported && reopens === 0 && replacements === 0) return null;
  const poll: MicPoll = { expectedMs: 0, deliveredMs: 0, contextMs: 0, ...reported, reopens, replacements };
  reported = null;
  reopens = 0;
  replacements = 0;
  return poll;
}
