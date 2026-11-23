// How hard the computer is working during a call, from the Compute Pressure
// API. It reads the whole system, a game included, so it only reports: the
// call's quality account keeps the highest state, and the strain watch
// (call-strain.ts) weighs it against what the call itself shows.

import type { CpuPressureState } from '@voiceroom/shared/contracts/feedback';
import { createLogger } from '../diagnostics';

export type { CpuPressureState };

const log = createLogger('room:cpu');

const SAMPLE_INTERVAL_MS = 2_000;
const MAX_SAMPLE_AGE_MS = 10_000;
const PRESSURE_RANK: Record<CpuPressureState, number> = { nominal: 0, fair: 1, serious: 2, critical: 3 };

interface PressureObserverLike {
  observe(source: 'cpu', options?: { sampleInterval?: number }): Promise<void>;
  disconnect(): void;
}

export type PressureObserverConstructor = new (
  callback: (records: Array<{ state: string; time?: number }>) => void
) => PressureObserverLike;

export interface CpuPressureWatchOptions {
  /** Every reported state. */
  onState: (state: CpuPressureState, sampledAt: number) => void;
  PressureObserver?: PressureObserverConstructor;
}

let observer: PressureObserverLike | null = null;
let generation = 0;

function isPressureState(value: unknown): value is CpuPressureState {
  return typeof value === 'string' && Object.hasOwn(PRESSURE_RANK, value);
}

function getPressureObserver(): PressureObserverConstructor | undefined {
  return globalThis.PressureObserver;
}

export function isCpuPressureFresh(sampledAt: number): boolean {
  return performance.now() - sampledAt <= MAX_SAMPLE_AGE_MS;
}

// The Compute Pressure API is not in lib.dom yet; browsers without it leave it undefined.
declare global {
  var PressureObserver: PressureObserverConstructor | undefined;
}

export function startCpuPressureWatch(options: CpuPressureWatchOptions): boolean {
  stopCpuPressureWatch();
  const Observer = options.PressureObserver ?? getPressureObserver();
  if (typeof Observer !== 'function') return false;

  const current = ++generation;
  try {
    observer = new Observer((records) => {
      if (current !== generation) return;
      const latest = records.at(-1);
      if (!latest || !isPressureState(latest.state)) return;
      options.onState(latest.state, latest.time ?? performance.now());
    });
    observer.observe('cpu', { sampleInterval: SAMPLE_INTERVAL_MS }).catch((error: unknown) => {
      log.info('cpu pressure unavailable', { reason: error instanceof Error ? error.name : 'unknown' });
    });
    return true;
  } catch (error) {
    log.info('cpu pressure unavailable', { reason: error instanceof Error ? error.name : 'unknown' });
    observer = null;
    return false;
  }
}

export function stopCpuPressureWatch(): void {
  generation += 1;
  try {
    observer?.disconnect();
  } catch {
    // Already gone with the page.
  }
  observer = null;
}

export function maxCpuPressure(a: CpuPressureState, b: CpuPressureState): CpuPressureState {
  return PRESSURE_RANK[b] > PRESSURE_RANK[a] ? b : a;
}
