// The connection as this client judges it: good, unstable or bad by the shared
// thresholds (@voice-room/shared/network-quality). The room's connection pill
// shows each poll's level; the admin panel's call bars get a steadier one, a
// level that held for two of the last five polls, sent only when it changes
// (network-report.ts).

import type { NetworkLevel } from '@voice-room/shared/contracts/rooms';
import { networkLevelOf, worseNetworkLevel } from '@voice-room/shared/network-quality';
import type { LocalConnectionQuality, VoiceConnection } from '../core/types';
import type { NetworkSample } from './call-quality';

/** Polls the reported level is read over (PEER_LATENCY_INTERVAL_MS apart). */
export const NETWORK_WINDOW = 5;
/** A new level waits this long after the last one sent, so a flapping link sends little. */
export const NETWORK_MIN_SEND_GAP_MS = 10_000;

export interface NetworkReading {
  sample: NetworkSample;
  quality: LocalConnectionQuality;
  voice: VoiceConnection;
}

/** One poll's level; null when the poll knew nothing at all. */
export function readingLevel({ sample, quality, voice }: NetworkReading): NetworkLevel | null {
  if (voice === 'reconnecting' || voice === 'signal-reconnecting' || voice === 'lost' || quality === 'lost') {
    return 'bad';
  }
  const measured = networkLevelOf(sample);
  // LiveKit's own rating stands in when the numbers are missing, and a poor one is never good.
  if (quality === 'poor') return worseNetworkLevel(measured, 'unstable');
  return measured ?? (quality === 'unknown' ? null : 'good');
}

/** The level over a window of polls: two bad make it bad, two not good make it unstable. */
export function windowLevel(levels: readonly NetworkLevel[]): NetworkLevel | null {
  if (levels.length < 2) return null;
  const bad = levels.filter((level) => level === 'bad').length;
  const notGood = levels.filter((level) => level !== 'good').length;
  if (bad >= 2) return 'bad';
  return notGood >= 2 ? 'unstable' : 'good';
}

/**
 * Tracks the reported level and sends its changes. `send` answers whether the
 * level went out; one that did not is tried again on the next poll.
 */
export function createNetworkLevelTracker(send: (level: NetworkLevel) => boolean, now: () => number = Date.now) {
  let recent: NetworkLevel[] = [];
  let sent: NetworkLevel | null = null;
  let sentAt = -Infinity;

  function note(reading: NetworkReading): void {
    const level = readingLevel(reading);
    if (!level) return;
    recent = [...recent, level].slice(-NETWORK_WINDOW);
    const next = windowLevel(recent);
    if (!next || next === sent || now() - sentAt < NETWORK_MIN_SEND_GAP_MS) return;
    if (!send(next)) return;
    sent = next;
    sentAt = now();
  }

  /** A new call starts from nothing known. */
  function reset(): void {
    recent = [];
    sent = null;
    sentAt = -Infinity;
  }

  /** The level the server was last told; null before the first. */
  const current = (): NetworkLevel | null => sent;

  return { note, reset, current };
}
