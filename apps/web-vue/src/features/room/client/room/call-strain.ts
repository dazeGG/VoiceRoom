// Whether the computer is hurting the call itself, not only busy. The Compute
// Pressure API reads the whole system, and a game keeps it critical through
// calls that sound fine, so a busy system alone relieves nothing. The call is
// strained when a full loss window (five polls, about 15 seconds) shows:
// - the browser holding our video encoders back for CPU at least half the
//   time (qualityLimitationDurations: its own verdict, so it needs no
//   pressure API);
// - or, with the system under serious or critical pressure through the whole
//   window, other people's video frames dropped instead of shown while their
//   video lost almost no packets, or their sound made up (concealment) while
//   almost no packets were lost or came too late and the jitter stayed low:
//   then the gap came from this computer rather than the line.
// The first strained window relieves the call once (room.ts); the reason and
// its figure go to the client log.

import { CONCEALMENT_THRESHOLDS, NETWORK_THRESHOLDS } from '@voice-room/shared/network-quality';
import { createLogger } from '@/shared/log';
import type { CpuPressureState } from '../services/cpu-pressure';
import type { PollCounts } from './call-quality';
import { CONCEALMENT_MIN_SAMPLES, LOSS_MIN_PACKETS, LOSS_WINDOW_POLLS, createRatioWindow } from './loss-window';

const log = createLogger('room:cpu');

/** Less encoding than this in the window (each video source once) says nothing. */
export const ENCODER_MIN_SECONDS = 10;
/** Our encoders held back for CPU at least this share of the window. */
export const ENCODER_CPU_STRAINED_PCT = 50;
/** Fewer incoming video frames than this in the window say nothing: four seconds of one camera. */
export const FRAMES_MIN = 100;
/** Incoming video frames dropped at least this share of the window. */
export const FRAMES_DROPPED_STRAINED_PCT = 10;
/** Below this share of packets lost (or, for sound, also too late), a gap came from the computer, not the line. */
export const CLEAN_LINE_LOSS_PCT = 1;

export type StrainReason = 'encoder' | 'frames' | 'sound';

/** One stats poll's own share of the counters the strain is judged by. */
export interface StrainCounts extends Pick<
  PollCounts,
  'inboundPackets' | 'inboundLost' | 'playedSamples' | 'concealedSamples'
> {
  /** Incoming audio packets that came too late to be played (packetsDiscarded). */
  inboundDiscarded: number;
  /** The poll's incoming audio jitter in ms; null when nothing came in. */
  jitterMs: number | null;
  /** Seconds our video sources were encoded, and those the browser held back for CPU. */
  encodeSeconds: number;
  encodeCpuSeconds: number;
  /** Other people's video frames that arrived, and those dropped instead of shown. */
  framesReceived: number;
  framesDropped: number;
  /** Other people's video packets, the lost ones included, and the lost ones. */
  videoPackets: number;
  videoLost: number;
}

export interface Strain {
  reason: StrainReason;
  /** The share that crossed its line, in percent. */
  pct: number;
}

const isBusy = (pressure: CpuPressureState | null) => pressure === 'serious' || pressure === 'critical';

export function createStrainTracker() {
  const encoder = createRatioWindow(ENCODER_MIN_SECONDS);
  let encoderPolls = 0;
  // Frames and sound count only while the system stays busy: a window that
  // began before it turned busy would blame the computer for an earlier blip.
  const frames = createRatioWindow(FRAMES_MIN);
  const videoLoss = createRatioWindow(LOSS_MIN_PACKETS);
  const audioLoss = createRatioWindow(LOSS_MIN_PACKETS);
  const concealment = createRatioWindow(CONCEALMENT_MIN_SAMPLES);
  let jitters: number[] = [];
  let busyPolls = 0;

  function resetBusy(): void {
    frames.reset();
    videoLoss.reset();
    audioLoss.reset();
    concealment.reset();
    jitters = [];
    busyPolls = 0;
  }

  /** Adds one poll; answers the strain over the full window, or null while the call is not strained. */
  function note(counts: StrainCounts, pressure: CpuPressureState | null): Strain | null {
    const encoderPct = encoder.add(counts.encodeCpuSeconds, counts.encodeSeconds);
    encoderPolls = Math.min(encoderPolls + 1, LOSS_WINDOW_POLLS);
    if (encoderPolls >= LOSS_WINDOW_POLLS && encoderPct !== null && encoderPct >= ENCODER_CPU_STRAINED_PCT) {
      return { reason: 'encoder', pct: encoderPct };
    }

    if (!isBusy(pressure)) {
      resetBusy();
      return null;
    }
    const droppedPct = frames.add(counts.framesDropped, counts.framesReceived);
    const videoLossPct = videoLoss.add(counts.videoLost, counts.videoPackets);
    const audioLossPct = audioLoss.add(counts.inboundLost + counts.inboundDiscarded, counts.inboundPackets);
    const concealedPct = concealment.add(counts.concealedSamples, counts.playedSamples);
    jitters = [...jitters, counts.jitterMs ?? 0].slice(-LOSS_WINDOW_POLLS);
    busyPolls = Math.min(busyPolls + 1, LOSS_WINDOW_POLLS);
    if (busyPolls < LOSS_WINDOW_POLLS) return null;

    if (
      droppedPct !== null &&
      droppedPct >= FRAMES_DROPPED_STRAINED_PCT &&
      videoLossPct !== null &&
      videoLossPct < CLEAN_LINE_LOSS_PCT
    ) {
      return { reason: 'frames', pct: droppedPct };
    }
    if (
      concealedPct !== null &&
      concealedPct >= CONCEALMENT_THRESHOLDS.noticeablePct &&
      audioLossPct !== null &&
      audioLossPct < CLEAN_LINE_LOSS_PCT &&
      Math.max(...jitters) < NETWORK_THRESHOLDS.unstable.jitterMs
    ) {
      return { reason: 'sound', pct: concealedPct };
    }
    return null;
  }

  function reset(): void {
    encoder.reset();
    encoderPolls = 0;
    resetBusy();
  }

  return { note, reset };
}

// The call's watch: one tracker, the latest system pressure, and one relief a call.
const tracker = createStrainTracker();
let pressure: CpuPressureState | null = null;
let onStrain: ((strain: Strain) => void) | null = null;

/** A new call is judged from nothing; `relieve` runs on its first strained window. */
export function startCallStrainWatch(relieve: (strain: Strain) => void): void {
  tracker.reset();
  pressure = null;
  onStrain = relieve;
}

export function stopCallStrainWatch(): void {
  tracker.reset();
  pressure = null;
  onStrain = null;
}

/** The system's latest pressure (cpu-pressure.ts); null where the browser has no API. */
export function noteCpuPressure(state: CpuPressureState): void {
  pressure = state;
}

/** Whether other people's frames and sound are worth reading: they only count while the system is busy. */
export function isSystemBusy(): boolean {
  return isBusy(pressure);
}

export function noteCallStrain(counts: StrainCounts): void {
  if (!onStrain) return;
  const strain = tracker.note(counts, pressure);
  if (!strain) return;
  const relieve = onStrain;
  onStrain = null;
  log.warn('call strained', { reason: strain.reason, pct: strain.pct, pressure: pressure ?? 'unknown' });
  relieve(strain);
}
