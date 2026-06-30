import { PEER_LATENCY_INTERVAL_MS, SPEAKING_STATS_INTERVAL_MS } from '../core/config';
import { state } from '../core/state.svelte';
import { findFirstLocalPublication, findLocalMicrophonePublication } from '../services/livekit-service';
import { setParticipantSpeaking } from './participants';

let peerLatencyTimer = 0;
let speakingStatsTimer = 0;

export function startPeerLatencyStats(): void {
  if (peerLatencyTimer) return;

  updatePeerLatencyStats().catch((error) => console.warn('Peer latency unavailable', error));
  peerLatencyTimer = window.setInterval(() => {
    updatePeerLatencyStats().catch((error) => console.warn('Peer latency unavailable', error));
  }, PEER_LATENCY_INTERVAL_MS);
}

export function stopPeerLatencyStats(): void {
  if (peerLatencyTimer) window.clearInterval(peerLatencyTimer);
  peerLatencyTimer = 0;
}

async function updatePeerLatencyStats(): Promise<void> {
  if (!state.joined) return;

  await updateLocalLiveKitLatency();
}

async function updateLocalLiveKitLatency(): Promise<void> {
  try {
    const publication = state.localMicPublication || findLocalMicrophonePublication() || findFirstLocalPublication();
    const stats = await publication?.track?.getRTCStatsReport?.();
    const rttMs = getRoundTripTimeFromStats(stats);
    if (rttMs !== null) {
      state.localPingMs = Math.max(0, Math.round(rttMs));
    }
  } catch (error) {
    console.warn('LiveKit latency unavailable', error);
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

export function startSpeakingStats(): void {
  if (speakingStatsTimer) return;

  const tick = () => {
    updateSpeakingStats().catch((error) => console.warn('Speaking stats unavailable', error));
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
    setParticipantSpeaking(peer, !peer.muted && peer.incomingVoiceActive);
  }
}
