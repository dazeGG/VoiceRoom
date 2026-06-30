import { GATE_THRESHOLD_MIN_DB, LOCAL_GATE_DISABLED_SPEAKING_DB } from '../core/config';
import { state } from '../core/state.svelte';
import { amplitudeToDb } from '../core/settings';
import { getSharedAudioContext } from '../services/media-playback-service';
import { isGateDisabled } from '../services/microphone-service';
import { refreshMicrophoneLevelMeter } from '../ui/devices';
import { setParticipantSpeaking } from '../room/participants';
import type { Participant } from '../core/types';

let meterFrame = 0;

export function attachMeter(participant: Participant | null, stream: MediaStream | null): void {
  if (!participant || !stream) return;
  try {
    const context = getSharedAudioContext();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    participant.analyser = analyser;
    participant.meterData = new Uint8Array(analyser.frequencyBinCount);
  } catch (error) {
    console.warn('Audio meter unavailable', error);
  }
}

export function startMeters(): void {
  if (meterFrame) return;

  const tick = () => {
    updateMeter(state.self);
    for (const peer of state.peers.values()) updateMeter(peer);
    meterFrame = requestAnimationFrame(tick);
  };
  meterFrame = requestAnimationFrame(tick);
}

export function stopMeters(): void {
  if (meterFrame) cancelAnimationFrame(meterFrame);
  meterFrame = 0;
}

function updateMeter(participant: Participant | null): void {
  if (!participant?.analyser || !participant.meterData) return;

  participant.analyser.getByteTimeDomainData(participant.meterData);
  let sum = 0;
  for (const value of participant.meterData) {
    const centered = value - 128;
    sum += centered * centered;
  }

  const rms = Math.sqrt(sum / participant.meterData.length);
  const level = Math.min(1, rms / 48);
  const levelDb = amplitudeToDb(Math.min(1, rms / 128));
  const visibleLevel = participant.muted ? 0 : level;
  const visibleLevelDb = participant.muted ? GATE_THRESHOLD_MIN_DB : levelDb;
  participant.level = visibleLevel;
  if (participant.isLocal) {
    refreshMicrophoneLevelMeter(visibleLevelDb);
    setParticipantSpeaking(participant, isLocalMicrophoneSpeaking(participant, levelDb));
  }
}

function isLocalMicrophoneSpeaking(participant: Participant, levelDb: number): boolean {
  if (participant.muted) return false;
  if (!isGateDisabled()) return levelDb >= state.gateThresholdDb;

  return levelDb >= LOCAL_GATE_DISABLED_SPEAKING_DB;
}
