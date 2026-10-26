// How hard the computer is working during a call, from the Compute Pressure
// API. When it stays critical, the heavy part of our own pipeline steps aside
// the way Discord turns Krisp off: RNNoise gives way to the browser's noise
// suppression for the rest of the call. Without the API nothing changes.

import type { CpuPressureState } from '@voice-room/shared/contracts/feedback';
import { createLogger } from '$lib/shared/log';

export type { CpuPressureState };

const log = createLogger('room:cpu');

/** Critical has to last this long: a compile or a game loading is not an overload. */
export const CPU_CRITICAL_HOLD_MS = 10_000;
const SAMPLE_INTERVAL_MS = 2_000;
const PRESSURE_RANK: Record<CpuPressureState, number> = { nominal: 0, fair: 1, serious: 2, critical: 3 };

interface PressureObserverLike {
  observe(source: 'cpu', options?: { sampleInterval?: number }): Promise<void>;
  disconnect(): void;
}

export type PressureObserverConstructor = new (
  callback: (records: Array<{ state: string }>) => void
) => PressureObserverLike;

export interface CpuPressureWatchOptions {
  /** Called once per call when critical pressure has held for CPU_CRITICAL_HOLD_MS. */
  onCritical: () => void;
  /** Every reported state, for the call quality summary. */
  onState?: (state: CpuPressureState) => void;
  PressureObserver?: PressureObserverConstructor;
}

let observer: PressureObserverLike | null = null;
let criticalTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

function isPressureState(value: unknown): value is CpuPressureState {
  return typeof value === 'string' && Object.hasOwn(PRESSURE_RANK, value);
}

function getPressureObserver(): PressureObserverConstructor | undefined {
  return globalThis.PressureObserver;
}

// The Compute Pressure API is not in lib.dom yet; browsers without it leave it undefined.
declare global {
  var PressureObserver: PressureObserverConstructor | undefined;
}

function clearCriticalTimer(): void {
  if (criticalTimer) clearTimeout(criticalTimer);
  criticalTimer = null;
}

export function startCpuPressureWatch(options: CpuPressureWatchOptions): boolean {
  stopCpuPressureWatch();
  const Observer = options.PressureObserver ?? getPressureObserver();
  if (typeof Observer !== 'function') return false;

  const current = ++generation;
  let relieved = false;
  try {
    observer = new Observer((records) => {
      if (current !== generation) return;
      const latest = records[records.length - 1]?.state;
      if (!isPressureState(latest)) return;
      options.onState?.(latest);
      if (latest !== 'critical') {
        clearCriticalTimer();
        return;
      }
      if (relieved || criticalTimer) return;
      criticalTimer = setTimeout(() => {
        criticalTimer = null;
        if (current !== generation || relieved) return;
        relieved = true;
        log.warn('cpu pressure critical', { holdMs: CPU_CRITICAL_HOLD_MS });
        options.onCritical();
      }, CPU_CRITICAL_HOLD_MS);
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
  clearCriticalTimer();
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
