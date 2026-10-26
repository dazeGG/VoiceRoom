// When a connection is unstable or bad: one set of thresholds for the room's
// connection pill, the level the client reports for the admin panel's call
// bars, and the red numbers in the admin panel's call feedback.

import type { NetworkLevel } from './contracts/rooms.ts';

/**
 * Opus with RED conceals a few percent of loss and the jitter buffer a few
 * tens of milliseconds; past `unstable` listeners hear it. Past `bad` speech
 * breaks up or lags enough to talk over each other.
 */
export const NETWORK_THRESHOLDS = {
  unstable: { rttMs: 300, lossPct: 5, jitterMs: 30 },
  bad: { rttMs: 600, lossPct: 10, jitterMs: 60 }
} as const;

export type NetworkMeasure = keyof (typeof NETWORK_THRESHOLDS)['bad'];

/**
 * Audible concealment: the share of played sound the receiver had to make up
 * because packets came late or not at all (silence it filled in is not
 * counted). It is what a listener actually heard, whatever the cause: the
 * network or a computer too busy to keep up. Microsoft Teams calls a call
 * poor past 7 %.
 */
export const CONCEALMENT_THRESHOLDS = { noticeablePct: 3, badPct: 7 } as const;

/** A connection's numbers; null for one not measured. */
export interface NetworkNumbers {
  rttMs: number | null;
  inboundLossPct: number | null;
  outboundLossPct: number | null;
  jitterMs: number | null;
}

const RANK: Record<NetworkLevel, number> = { good: 0, unstable: 1, bad: 2 };

/** The worse of two levels; a known level beats an unknown one. */
export function worseNetworkLevel(a: NetworkLevel | null, b: NetworkLevel | null): NetworkLevel | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[b] > RANK[a] ? b : a;
}

/** One number against its thresholds; null when it was not measured. */
export function networkLevelOfValue(measure: NetworkMeasure, value: number | null | undefined): NetworkLevel | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value >= NETWORK_THRESHOLDS.bad[measure]) return 'bad';
  if (value >= NETWORK_THRESHOLDS.unstable[measure]) return 'unstable';
  return 'good';
}

/** The worst level among the numbers; null when none was measured. */
export function networkLevelOf(numbers: NetworkNumbers): NetworkLevel | null {
  return [
    networkLevelOfValue('rttMs', numbers.rttMs),
    networkLevelOfValue('lossPct', numbers.inboundLossPct),
    networkLevelOfValue('lossPct', numbers.outboundLossPct),
    networkLevelOfValue('jitterMs', numbers.jitterMs)
  ].reduce<NetworkLevel | null>(worseNetworkLevel, null);
}
