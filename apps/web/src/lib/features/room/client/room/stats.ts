import { PEER_LATENCY_INTERVAL_MS } from '../core/config';
import { state } from '../core/state.svelte';
import { findFirstLocalPublication, findLocalMicrophonePublication } from '../services/livekit-service';
import { readRtcStats, type RtcStat } from '../media/rtc-stats';
import { recordNetworkSample } from './call-quality';

import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:stats');

let peerLatencyTimer = 0;

export function startPeerLatencyStats(): void {
  if (peerLatencyTimer) return;

  updatePeerLatencyStats().catch((error: unknown) => log.warn('peer latency unavailable', errorContext(error)));
  peerLatencyTimer = window.setInterval(() => {
    updatePeerLatencyStats().catch((error: unknown) => log.warn('peer latency unavailable', errorContext(error)));
  }, PEER_LATENCY_INTERVAL_MS);
}

export function stopPeerLatencyStats(): void {
  if (peerLatencyTimer) window.clearInterval(peerLatencyTimer);
  peerLatencyTimer = 0;
}

async function updatePeerLatencyStats(): Promise<void> {
  if (!state.joined) return;

  await updateLocalLiveKitLatency();
  await updateInboundAudioStats();
  if (!state.joined) return;
  recordNetworkSample({ ...state.localNetwork, rttMs: state.localPingMs });
}

// Cumulative inbound counters from the previous poll, per stats id, so loss is
// reported for the last interval instead of since the call started.
let previousInbound = new Map<string, { lost: number; received: number }>();

async function updateInboundAudioStats(): Promise<void> {
  const current = new Map<string, { lost: number; received: number }>();
  let lost = 0;
  let received = 0;
  let jitterSum = 0;
  let jitterCount = 0;
  for (const peer of state.peers.values()) {
    for (const publication of peer.livekitParticipant?.audioTrackPublications?.values() || []) {
      const track = publication.track;
      const stats = readRtcStats(await track?.getRTCStatsReport?.().catch(() => undefined));
      for (const report of stats.values()) {
        if (report.type !== 'inbound-rtp' || report.kind !== 'audio') continue;
        const totals = {
          lost: Math.max(0, report.packetsLost || 0),
          received: report.packetsReceived || 0
        };
        const before = previousInbound.get(report.id) || { lost: 0, received: 0 };
        current.set(report.id, totals);
        lost += Math.max(0, totals.lost - before.lost);
        received += Math.max(0, totals.received - before.received);
        if (report.jitter !== undefined) {
          jitterSum += report.jitter * 1000;
          jitterCount += 1;
        }
      }
    }
  }
  previousInbound = current;
  state.localNetwork.inboundLossPct = lost + received > 0 ? roundPct((lost / (lost + received)) * 100) : null;
  state.localNetwork.jitterMs = jitterCount > 0 ? Math.round(jitterSum / jitterCount) : null;
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

async function updateLocalLiveKitLatency(): Promise<void> {
  try {
    const publication = state.localMicPublication || findLocalMicrophonePublication() || findFirstLocalPublication();
    const stats = readRtcStats(await publication?.track?.getRTCStatsReport?.());
    const rttMs = getRoundTripTimeFromStats(stats);
    if (rttMs !== null) {
      state.localPingMs = Math.max(0, Math.round(rttMs));
    }
    const outbound = outboundNetwork(stats);
    state.localNetwork.outboundLossPct = outbound.lossPct;
    state.localNetwork.transport = outbound.transport;
  } catch (error) {
    log.warn('liveKit latency unavailable', errorContext(error));
  }
}

function getRoundTripTimeFromStats(stats: Map<string, RtcStat>): number | null {
  let candidatePairRttMs: number | null = null;
  let remoteInboundRttMs: number | null = null;
  for (const report of stats.values()) {
    if (isActiveCandidatePair(report) && report.currentRoundTripTime !== undefined) {
      candidatePairRttMs = report.currentRoundTripTime * 1000;
      continue;
    }

    if (remoteInboundRttMs === null && report.type === 'remote-inbound-rtp' && report.roundTripTime !== undefined) {
      remoteInboundRttMs = report.roundTripTime * 1000;
    }
  }

  return candidatePairRttMs ?? remoteInboundRttMs;
}

function isActiveCandidatePair(report: RtcStat): boolean {
  return (
    report.type === 'candidate-pair' && report.state === 'succeeded' && Boolean(report.nominated || report.selected)
  );
}

/**
 * Upstream loss as the SFU reports it back (remote-inbound-rtp fractionLost)
 * and the transport of the selected candidate pair: a relay or TCP candidate
 * means UDP was blocked and latency/jitter will be worse.
 */
export function getOutboundNetworkFromStats(report: RTCStatsReport | undefined): {
  lossPct: number | null;
  transport: 'udp' | 'tcp' | 'relay' | null;
} {
  return outboundNetwork(readRtcStats(report));
}

function outboundNetwork(stats: Map<string, RtcStat>): {
  lossPct: number | null;
  transport: 'udp' | 'tcp' | 'relay' | null;
} {
  let lossPct: number | null = null;
  let transport: 'udp' | 'tcp' | 'relay' | null = null;
  for (const report of stats.values()) {
    if (report.type === 'remote-inbound-rtp' && report.fractionLost !== undefined && lossPct === null) {
      lossPct = roundPct(Math.max(0, report.fractionLost) * 100);
    }
    if (isActiveCandidatePair(report)) {
      const local = report.localCandidateId === undefined ? undefined : stats.get(report.localCandidateId);
      if (local?.candidateType === 'relay') transport = 'relay';
      else if (local) transport = local.protocol?.toLowerCase() === 'tcp' ? 'tcp' : 'udp';
    }
  }
  return { lossPct, transport };
}
