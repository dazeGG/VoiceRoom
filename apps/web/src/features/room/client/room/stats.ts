import { PEER_LATENCY_INTERVAL_MS } from '../core/config';
import { state } from '../core/room-runtime.store';
import { findFirstLocalPublication, findLocalMicrophonePublication } from '../services/livekit-service';
import { isActiveCandidatePair, readRtcStats, type RtcStat, type RtcStatsSource } from '../media/rtc-stats';
import { isRecord } from '@voice-room/shared/guards';
import {
  recordLoadCounts,
  recordNetworkSample,
  recordPollCounts,
  type LoadCounts,
  type PollCounts
} from './call-quality';
import { isSystemBusy, noteCallStrain, type StrainCounts } from './call-strain';
import { createLossWindow } from './loss-window';
import { noteNetworkReading } from './network-report';

import { createLogger, errorContext } from '@/shared/log';

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
  previousVideo = new Map();
  previousLoad = null;
  inboundLoss.reset();
  outboundLoss.reset();
}

async function updatePeerLatencyStats(): Promise<void> {
  if (!state.joined) return;

  const outbound = await updateLocalLiveKitLatency();
  const inbound = await updateInboundAudioStats();
  const video = await readVideoStrain();
  const load = await readDesktopLoad();
  if (!state.joined) return;
  const sample = { ...state.localNetwork, rttMs: state.localPingMs };
  recordNetworkSample(sample);
  recordPollCounts({ ...inbound, ...outbound });
  noteCallStrain({ ...inbound, ...video });
  recordLoadCounts(load);
  noteNetworkReading({ sample, quality: state.localConnectionQuality, voice: state.voiceConnection });
}

// The browser's counters only ever grow. Each poll keeps the previous reading
// (inbound per stats id) and takes its own difference, so nothing between two
// polls is missed or counted twice; the loss windows (loss-window.ts) then
// count over the last few polls, the call's account (call-quality.ts) over all.
interface InboundReading {
  lost: number;
  received: number;
  discarded: number;
  played: number;
  concealed: number;
}
let previousInbound = new Map<string, InboundReading>();
let previousOutbound: { lost: number; sent: number } | null = null;
let previousChecks: { seconds: number; checks: number } | null = null;
const inboundLoss = createLossWindow();
const outboundLoss = createLossWindow();

type InboundCounts = Pick<
  StrainCounts,
  'inboundPackets' | 'inboundLost' | 'inboundDiscarded' | 'playedSamples' | 'concealedSamples' | 'jitterMs'
>;
type OutboundCounts = Pick<PollCounts, 'outboundPackets' | 'outboundLost' | 'rttSeconds' | 'rttChecks'>;

/** The growth of a counter since the last reading; a counter that went back (a new stream) starts over from zero. */
const growth = (now: number, before: number) => (now >= before ? now - before : now);

async function updateInboundAudioStats(): Promise<InboundCounts> {
  const current = new Map<string, InboundReading>();
  const counts: InboundCounts = {
    inboundPackets: 0,
    inboundLost: 0,
    inboundDiscarded: 0,
    playedSamples: 0,
    concealedSamples: 0,
    jitterMs: null
  };
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
          discarded: report.packetsDiscarded || 0,
          played: report.totalSamplesReceived || 0,
          // Made-up sound that was silence anyway is not heard as a gap.
          concealed: Math.max(0, (report.concealedSamples || 0) - (report.silentConcealedSamples || 0))
        };
        const before = previousInbound.get(report.id) || {
          lost: 0,
          received: 0,
          discarded: 0,
          played: 0,
          concealed: 0
        };
        current.set(report.id, reading);
        const lost = growth(reading.lost, before.lost);
        counts.inboundLost += lost;
        counts.inboundPackets += lost + growth(reading.received, before.received);
        counts.inboundDiscarded += growth(reading.discarded, before.discarded);
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
  counts.jitterMs = state.localNetwork.jitterMs;
  return counts;
}

type VideoCounts = Pick<
  StrainCounts,
  'encodeSeconds' | 'encodeCpuSeconds' | 'framesReceived' | 'framesDropped' | 'videoPackets' | 'videoLost'
>;
interface VideoReading {
  seconds: number;
  cpuSeconds: number;
  received: number;
  dropped: number;
  packets: number;
  lost: number;
}
let previousVideo = new Map<string, VideoReading>();

/**
 * The poll's own video counters for the strain watch (call-strain.ts): how
 * long our encoders ran and how much of it the browser held them back for
 * CPU, each source once (simulcast layers of one camera share its time); and,
 * only while the system is busy, other people's frames that arrived and those
 * dropped, with their packets and the lost ones. No video, no stats read.
 */
async function readVideoStrain(): Promise<VideoCounts> {
  const counts: VideoCounts = {
    encodeSeconds: 0,
    encodeCpuSeconds: 0,
    framesReceived: 0,
    framesDropped: 0,
    videoPackets: 0,
    videoLost: 0
  };
  const encodedBySource = new Map<string, { seconds: number; cpuSeconds: number }>();
  // Screen audio comes along with the screen; only video entries of the reports count.
  const tracks: Array<{ getRTCStatsReport?(): Promise<RTCStatsReport | undefined> } | undefined> = [
    state.localCameraPublication,
    ...state.localScreenPublications.values()
  ].map((publication) => publication?.track);
  if (isSystemBusy()) {
    for (const peer of state.peers.values()) {
      for (const publication of peer.livekitParticipant?.videoTrackPublications?.values() || []) {
        tracks.push(publication.track);
      }
    }
  }
  const current = new Map<string, VideoReading>();
  for (const track of tracks) {
    const stats = readRtcStats(await track?.getRTCStatsReport?.().catch(() => undefined));
    for (const report of stats.values()) {
      if (report.kind !== 'video' || (report.type !== 'outbound-rtp' && report.type !== 'inbound-rtp')) continue;
      const reading: VideoReading = {
        seconds: report.qualityLimitationSeconds ?? 0,
        cpuSeconds: report.qualityLimitationCpuSeconds ?? 0,
        received: report.type === 'inbound-rtp' ? report.framesReceived || 0 : 0,
        dropped: report.type === 'inbound-rtp' ? report.framesDropped || 0 : 0,
        packets: report.type === 'inbound-rtp' ? report.packetsReceived || 0 : 0,
        lost: report.type === 'inbound-rtp' ? Math.max(0, report.packetsLost || 0) : 0
      };
      current.set(report.id, reading);
      // A stream first seen this poll only sets its baseline: its totals go back to its start.
      const before = previousVideo.get(report.id);
      if (!before) continue;
      if (report.type === 'outbound-rtp') {
        const source = report.mediaSourceId ?? report.id;
        const encoded = encodedBySource.get(source) ?? { seconds: 0, cpuSeconds: 0 };
        encoded.seconds = Math.max(encoded.seconds, growth(reading.seconds, before.seconds));
        encoded.cpuSeconds = Math.max(encoded.cpuSeconds, growth(reading.cpuSeconds, before.cpuSeconds));
        encodedBySource.set(source, encoded);
        continue;
      }
      const lost = growth(reading.lost, before.lost);
      counts.framesReceived += growth(reading.received, before.received);
      counts.framesDropped += growth(reading.dropped, before.dropped);
      counts.videoLost += lost;
      counts.videoPackets += lost + growth(reading.packets, before.packets);
    }
  }
  for (const encoded of encodedBySource.values()) {
    counts.encodeSeconds += encoded.seconds;
    counts.encodeCpuSeconds += Math.min(encoded.cpuSeconds, encoded.seconds);
  }
  previousVideo = current;
  return counts;
}

const NO_LOAD: LoadCounts = { appCpuMs: 0, systemBusyMs: 0, systemTotalMs: 0 };
let previousLoad: LoadCounts | null = null;

function toLoadReading(value: unknown): LoadCounts | null {
  if (!isRecord(value)) return null;
  const { appCpuMs, systemBusyMs, systemTotalMs } = value;
  if (typeof appCpuMs !== 'number' || typeof systemBusyMs !== 'number' || typeof systemTotalMs !== 'number')
    return null;
  return [appCpuMs, systemBusyMs, systemTotalMs].every((field) => Number.isFinite(field) && field >= 0)
    ? { appCpuMs, systemBusyMs, systemTotalMs }
    : null;
}

/**
 * The poll's own share of the desktop app's CPU totals (voiceRoomDesktopLoad):
 * VoiceRoom's processes apart from the whole computer. The first reading only
 * sets the baseline; outside the app, or with an older app, nothing is read.
 */
async function readDesktopLoad(): Promise<LoadCounts> {
  const bridge = window.voiceRoomDesktopLoad;
  if (typeof bridge?.read !== 'function') return NO_LOAD;
  const reading = toLoadReading(await bridge.read().catch(() => null));
  if (!reading) return NO_LOAD;
  const before = previousLoad;
  previousLoad = reading;
  if (
    !before ||
    reading.appCpuMs < before.appCpuMs ||
    reading.systemBusyMs < before.systemBusyMs ||
    reading.systemTotalMs < before.systemTotalMs
  ) {
    return NO_LOAD;
  }
  return {
    appCpuMs: reading.appCpuMs - before.appCpuMs,
    systemBusyMs: reading.systemBusyMs - before.systemBusyMs,
    systemTotalMs: reading.systemTotalMs - before.systemTotalMs
  };
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
