import { PEER_LATENCY_INTERVAL_MS } from '../core/config';
import { state } from '../core/state.svelte';
import { findFirstLocalPublication, findLocalMicrophonePublication } from '../services/livekit-service';
import { isActiveCandidatePair, readRtcStats, type RtcStat, type RtcStatsSource } from '../media/rtc-stats';
import { recordNetworkSample, recordPollCounts, type PollCounts } from './call-quality';
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
  previousChecks = null;
  inboundLoss.reset();
  outboundLoss.reset();
}

async function updatePeerLatencyStats(): Promise<void> {
  if (!state.joined) return;

  const outbound = await updateLocalLiveKitLatency();
  const inbound = await updateInboundAudioStats();
  if (!state.joined) return;
  const sample = { ...state.localNetwork, rttMs: state.localPingMs };
  recordNetworkSample(sample);
  recordPollCounts({ ...inbound, ...outbound });
  noteNetworkReading({ sample, quality: state.localConnectionQuality, voice: state.voiceConnection });
}

// The browser's counters only ever grow. Each poll keeps the previous reading
// (inbound per stats id) and takes its own difference, so nothing between two
// polls is missed or counted twice; the loss windows (loss-window.ts) then
// count over the last few polls, the call's account (call-quality.ts) over all.
interface InboundReading {
  lost: number;
  received: number;
  played: number;
  concealed: number;
}
let previousInbound = new Map<string, InboundReading>();
let previousOutbound: { lost: number; sent: number } | null = null;
let previousChecks: { seconds: number; checks: number } | null = null;
const inboundLoss = createLossWindow();
const outboundLoss = createLossWindow();

type InboundCounts = Pick<PollCounts, 'inboundPackets' | 'inboundLost' | 'playedSamples' | 'concealedSamples'>;
type OutboundCounts = Pick<PollCounts, 'outboundPackets' | 'outboundLost' | 'rttSeconds' | 'rttChecks'>;

/** The growth of a counter since the last reading; a counter that went back (a new stream) starts over from zero. */
const growth = (now: number, before: number) => (now >= before ? now - before : now);

async function updateInboundAudioStats(): Promise<InboundCounts> {
  const current = new Map<string, InboundReading>();
  const counts: InboundCounts = { inboundPackets: 0, inboundLost: 0, playedSamples: 0, concealedSamples: 0 };
  let jitterSum = 0;
  let jitterCount = 0;
  for (const peer of state.peers.values()) {
    for (const publication of peer.livekitParticipant?.audioTrackPublications?.values() || []) {
      const track = publication.track;
      const stats = readRtcStats(await track?.getRTCStatsReport?.().catch(() => undefined));
      for (const report of stats.values()) {
        if (report.type !== 'inbound-rtp' || report.kind !== 'audio') continue;
        const reading: InboundReading = {
          lost: Math.max(0, report.packetsLost || 0),
          received: report.packetsReceived || 0,
          played: report.totalSamplesReceived || 0,
          // Made-up sound that was silence anyway is not heard as a gap.
          concealed: Math.max(0, (report.concealedSamples || 0) - (report.silentConcealedSamples || 0))
        };
        const before = previousInbound.get(report.id) || { lost: 0, received: 0, played: 0, concealed: 0 };
        current.set(report.id, reading);
        const lost = growth(reading.lost, before.lost);
        counts.inboundLost += lost;
        counts.inboundPackets += lost + growth(reading.received, before.received);
        counts.playedSamples += growth(reading.played, before.played);
        counts.concealedSamples += growth(reading.concealed, before.concealed);
        if (report.jitter !== undefined) {
          jitterSum += report.jitter * 1000;
          jitterCount += 1;
        }
      }
    }
  }
  previousInbound = current;
  state.localNetwork.inboundLossPct = inboundLoss.add(counts.inboundLost, counts.inboundPackets);
  state.localNetwork.jitterMs = jitterCount > 0 ? Math.round(jitterSum / jitterCount) : null;
  return counts;
}

const NO_OUTBOUND: OutboundCounts = { outboundPackets: 0, outboundLost: 0, rttSeconds: 0, rttChecks: 0 };

async function updateLocalLiveKitLatency(): Promise<OutboundCounts> {
  try {
    const publication = state.localMicPublication || findLocalMicrophonePublication() || findFirstLocalPublication();
    const stats = readRtcStats(await publication?.track?.getRTCStatsReport?.());
    const rttMs = getRoundTripTimeFromStats(stats);
    if (rttMs !== null) {
      state.localPingMs = Math.max(0, Math.round(rttMs));
    }
    const outbound = outboundNetwork(stats);
    const packets = noteOutboundPackets(outbound.packetsLost, outbound.packetsSent);
    state.localNetwork.outboundLossPct = outboundLoss.add(packets.lost, packets.sent);
    state.localNetwork.transport = outbound.transport;
    const checks = noteChecks(outbound.rttSeconds, outbound.rttChecks);
    return { outboundPackets: packets.sent, outboundLost: packets.lost, ...checks };
  } catch (error) {
    log.warn('liveKit latency unavailable', errorContext(error));
    return NO_OUTBOUND;
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

/** The poll's own upstream packets from the cumulative counters; the first reading only sets the baseline. */
function noteOutboundPackets(packetsLost: number | null, packetsSent: number | null): { lost: number; sent: number } {
  if (packetsLost === null || packetsSent === null) return { lost: 0, sent: 0 };
  const before = previousOutbound;
  previousOutbound = { lost: packetsLost, sent: packetsSent };
  // Counters that went back (a republished microphone) start a new baseline too.
  if (!before || packetsSent < before.sent || packetsLost < before.lost) return { lost: 0, sent: 0 };
  return { lost: packetsLost - before.lost, sent: packetsSent - before.sent };
}

/** The poll's own connection checks; a new pair (an ICE restart) starts a new baseline. */
function noteChecks(seconds: number | null, checks: number | null): Pick<PollCounts, 'rttSeconds' | 'rttChecks'> {
  if (seconds === null || checks === null) return { rttSeconds: 0, rttChecks: 0 };
  const before = previousChecks;
  previousChecks = { seconds, checks };
  if (!before || checks < before.checks || seconds < before.seconds) return { rttSeconds: 0, rttChecks: 0 };
  return { rttSeconds: seconds - before.seconds, rttChecks: checks - before.checks };
}

interface OutboundNetwork {
  /** Our audio packets the SFU says it never got (remote-inbound-rtp), since the stream began. */
  packetsLost: number | null;
  /** Our audio packets sent (outbound-rtp), since the stream began. */
  packetsSent: number | null;
  /** The selected pair's round trips summed, in seconds, and how many checks, since it began. */
  rttSeconds: number | null;
  rttChecks: number | null;
  transport: 'udp' | 'tcp' | 'relay' | null;
}

/**
 * Upstream loss counters as the SFU reports them back, the connection's
 * round-trip totals, and the transport of the selected candidate pair: a relay
 * or TCP candidate means UDP was blocked and latency/jitter will be worse.
 */
export function getOutboundNetworkFromStats(report: RtcStatsSource | undefined): OutboundNetwork {
  return outboundNetwork(readRtcStats(report));
}

function outboundNetwork(stats: Map<string, RtcStat>): OutboundNetwork {
  let packetsLost: number | null = null;
  let packetsSent: number | null = null;
  let rttSeconds: number | null = null;
  let rttChecks: number | null = null;
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
      if (report.totalRoundTripTime !== undefined && report.responsesReceived !== undefined) {
        rttSeconds = report.totalRoundTripTime;
        rttChecks = report.responsesReceived;
      }
      const local = report.localCandidateId === undefined ? undefined : stats.get(report.localCandidateId);
      if (local?.candidateType === 'relay') transport = 'relay';
      else if (local) transport = local.protocol?.toLowerCase() === 'tcp' ? 'tcp' : 'udp';
    }
  }
  return { packetsLost, packetsSent, rttSeconds, rttChecks, transport };
}
