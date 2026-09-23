import type { RemoteTrack } from 'livekit-client';
import { PEER_LATENCY_INTERVAL_MS, SPEAKING_STATS_INTERVAL_MS } from '../core/config';
import { state } from '../core/state.svelte';
import { findFirstLocalPublication, findLocalMicrophonePublication } from '../services/livekit-service';
import { setParticipantSpeaking } from './participants';

import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:stats');

let peerLatencyTimer = 0;
let speakingStatsTimer = 0;

export function startPeerLatencyStats(): void {
  if (peerLatencyTimer) return;

  updatePeerLatencyStats().catch((error) => log.warn('peer latency unavailable', errorContext(error)));
  peerLatencyTimer = window.setInterval(() => {
    updatePeerLatencyStats().catch((error) => log.warn('peer latency unavailable', errorContext(error)));
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
      const track = publication.track as RemoteTrack | undefined;
      const stats = await track?.getRTCStatsReport?.().catch(() => undefined);
      stats?.forEach((report: any) => {
        if (report.type !== 'inbound-rtp' || report.kind !== 'audio') return;
        const totals = { lost: Math.max(0, Number(report.packetsLost) || 0), received: Number(report.packetsReceived) || 0 };
        const before = previousInbound.get(report.id) || { lost: 0, received: 0 };
        current.set(report.id, totals);
        lost += Math.max(0, totals.lost - before.lost);
        received += Math.max(0, totals.received - before.received);
        if (typeof report.jitter === 'number') {
          jitterSum += report.jitter * 1000;
          jitterCount += 1;
        }
      });
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
    const stats = await publication?.track?.getRTCStatsReport?.();
    const rttMs = getRoundTripTimeFromStats(stats);
    if (rttMs !== null) {
      state.localPingMs = Math.max(0, Math.round(rttMs));
    }
    const outbound = getOutboundNetworkFromStats(stats);
    state.localNetwork.outboundLossPct = outbound.lossPct;
    state.localNetwork.transport = outbound.transport;
  } catch (error) {
    log.warn('liveKit latency unavailable', errorContext(error));
  }
}

function getRoundTripTimeFromStats(stats: RTCStatsReport | undefined): number | null {
  if (!stats?.forEach) return null;

  let candidatePairRttMs: number | null = null;
  let remoteInboundRttMs: number | null = null;
  stats.forEach((report) => {
    if (
      report.type === 'candidate-pair'
      && report.state === 'succeeded'
      && (report.nominated || report.selected)
      && typeof report.currentRoundTripTime === 'number'
    ) {
      candidatePairRttMs = report.currentRoundTripTime * 1000;
      return;
    }

    if (
      remoteInboundRttMs === null
      && report.type === 'remote-inbound-rtp'
      && typeof report.roundTripTime === 'number'
    ) {
      remoteInboundRttMs = report.roundTripTime * 1000;
    }
  });

  return candidatePairRttMs ?? remoteInboundRttMs;
}

/**
 * Upstream loss as the SFU reports it back (remote-inbound-rtp fractionLost)
 * and the transport of the selected candidate pair: a relay or TCP candidate
 * means UDP was blocked and latency/jitter will be worse.
 */
export function getOutboundNetworkFromStats(stats: RTCStatsReport | undefined): {
  lossPct: number | null;
  transport: 'udp' | 'tcp' | 'relay' | null;
} {
  if (!stats?.forEach) return { lossPct: null, transport: null };
  const reports = new Map<string, any>();
  stats.forEach((report) => reports.set(report.id, report));
  let lossPct: number | null = null;
  let transport: 'udp' | 'tcp' | 'relay' | null = null;
  for (const report of reports.values()) {
    if (report.type === 'remote-inbound-rtp' && typeof report.fractionLost === 'number' && lossPct === null) {
      lossPct = roundPct(Math.max(0, report.fractionLost) * 100);
    }
    if (
      report.type === 'candidate-pair'
      && report.state === 'succeeded'
      && (report.nominated || report.selected)
    ) {
      const local = reports.get(report.localCandidateId);
      if (local?.candidateType === 'relay') transport = 'relay';
      else if (local) transport = String(local.protocol).toLowerCase() === 'tcp' ? 'tcp' : 'udp';
    }
  }
  return { lossPct, transport };
}

export function startSpeakingStats(): void {
  if (speakingStatsTimer) return;

  const tick = () => {
    updateSpeakingStats().catch((error) => log.warn('speaking stats unavailable', errorContext(error)));
  };
  speakingStatsTimer = window.setInterval(tick, SPEAKING_STATS_INTERVAL_MS);
  tick();
}

export function stopSpeakingStats(): void {
  if (speakingStatsTimer) window.clearInterval(speakingStatsTimer);
  speakingStatsTimer = 0;
  setParticipantSpeaking(state.self, false);
  for (const peer of state.peers.values()) {
    peer.incomingVoiceActive = false;
    setParticipantSpeaking(peer, false);
  }
}

async function updateSpeakingStats(): Promise<void> {
  if (!state.joined) return;

  for (const peer of state.peers.values()) {
    peer.incomingVoiceActive = Boolean(peer.livekitParticipant?.isSpeaking);
    // The audio meter owns the ring whenever it can see the decoded track; the
    // server's view only fills in before the analyser is attached, because it
    // is sampled on an interval and lags audible speech.
    if (peer.analyser) continue;
    setParticipantSpeaking(peer, !peer.muted && !state.outputMuted && peer.incomingVoiceActive);
  }
}
