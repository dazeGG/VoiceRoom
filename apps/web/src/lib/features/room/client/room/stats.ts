import { PEER_LATENCY_INTERVAL_MS } from '../core/config';
import { state } from '../core/state.svelte';
import { findFirstLocalPublication, findLocalMicrophonePublication } from '../services/livekit-service';
import { isActiveCandidatePair, readRtcStats, type RtcStat, type RtcStatsSource } from '../media/rtc-stats';
import { recordNetworkSample } from './call-quality';
import { createLossWindow } from './loss-window';
import { noteNetworkReading } from './network-report';

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
  previousInbound = new Map();
  previousOutbound = null;
  inboundLoss.reset();
  outboundLoss.reset();
}

async function updatePeerLatencyStats(): Promise<void> {
  if (!state.joined) return;

  await updateLocalLiveKitLatency();
  await updateInboundAudioStats();
  if (!state.joined) return;
  const sample = { ...state.localNetwork, rttMs: state.localPingMs };
  recordNetworkSample(sample);
  noteNetworkReading({ sample, quality: state.localConnectionQuality, voice: state.voiceConnection });
}

// Cumulative counters from the previous poll (inbound per stats id), so each
// poll adds only its own packets; the loss windows (loss-window.ts) then count
// over the last few polls, not since the call started.
let previousInbound = new Map<string, { lost: number; received: number }>();
let previousOutbound: { lost: number; sent: number } | null = null;
const inboundLoss = createLossWindow();
const outboundLoss = createLossWindow();

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
  state.localNetwork.inboundLossPct = inboundLoss.add(lost, lost + received);
  state.localNetwork.jitterMs = jitterCount > 0 ? Math.round(jitterSum / jitterCount) : null;
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
    state.localNetwork.outboundLossPct = noteOutboundPackets(outbound.packetsLost, outbound.packetsSent);
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

/** The poll's share of upstream loss, from the cumulative counters: the window decides if there is a figure. */
function noteOutboundPackets(packetsLost: number | null, packetsSent: number | null): number | null {
  if (packetsLost === null || packetsSent === null) return null;
  const before = previousOutbound;
  previousOutbound = { lost: packetsLost, sent: packetsSent };
  // The first poll, or counters that went back (a republished microphone), only set the baseline.
  if (!before || packetsSent < before.sent || packetsLost < before.lost) return outboundLoss.add(0, 0);
  return outboundLoss.add(packetsLost - before.lost, packetsSent - before.sent);
}

interface OutboundNetwork {
  /** Our audio packets the SFU says it never got (remote-inbound-rtp), since the stream began. */
  packetsLost: number | null;
  /** Our audio packets sent (outbound-rtp), since the stream began. */
  packetsSent: number | null;
  transport: 'udp' | 'tcp' | 'relay' | null;
}

/**
 * Upstream loss counters as the SFU reports them back, and the transport of
 * the selected candidate pair: a relay or TCP candidate means UDP was blocked
 * and latency/jitter will be worse.
 */
export function getOutboundNetworkFromStats(report: RtcStatsSource | undefined): OutboundNetwork {
  return outboundNetwork(readRtcStats(report));
}

function outboundNetwork(stats: Map<string, RtcStat>): OutboundNetwork {
  let packetsLost: number | null = null;
  let packetsSent: number | null = null;
  let transport: 'udp' | 'tcp' | 'relay' | null = null;
  for (const report of stats.values()) {
    // Audio only: with no microphone the first publication may be a camera.
    if (report.kind !== undefined && report.kind !== 'audio') continue;
    if (report.type === 'remote-inbound-rtp' && report.packetsLost !== undefined) {
      packetsLost = (packetsLost ?? 0) + Math.max(0, report.packetsLost);
    }
    if (report.type === 'outbound-rtp' && report.packetsSent !== undefined) {
      packetsSent = (packetsSent ?? 0) + report.packetsSent;
    }
    if (isActiveCandidatePair(report)) {
      const local = report.localCandidateId === undefined ? undefined : stats.get(report.localCandidateId);
      if (local?.candidateType === 'relay') transport = 'relay';
      else if (local) transport = local.protocol?.toLowerCase() === 'tcp' ? 'tcp' : 'udp';
    }
  }
  return { packetsLost, packetsSent, transport };
}
