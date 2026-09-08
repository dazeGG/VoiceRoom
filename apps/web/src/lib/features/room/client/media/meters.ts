import { roomDeviceUi } from '$lib/features/room/room-device-ui.svelte';
import {
  GATE_THRESHOLD_MIN_DB,
  LOCAL_GATE_DISABLED_SPEAKING_DB,
  REMOTE_SPEAKING_DB,
  SPEAKING_RELEASE_HOLD_MS
} from '../core/config';
import { state } from '../core/state.svelte';
import { amplitudeToDb } from '../core/settings';
import { getSharedAudioContext } from '../services/media-playback-service';
import { isGateDisabled } from '../services/microphone-service';
import { bumpParticipantsRevision } from '../../participants-ui.svelte';
import type { Participant } from '../core/types';

let meterFrame = 0;

function refreshMicrophoneLevelMeterSoon(levelDb: number): void {
  void import('../ui/devices').then((module) => module.refreshMicrophoneLevelMeter(levelDb));
}

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
  if (participant.isLocal && roomDeviceUi.devicePopoverOpen) {
    refreshMicrophoneLevelMeterSoon(visibleLevelDb);
  }
  applySpeaking(participant, isOverSpeakingThreshold(participant, levelDb));
}

/**
 * Both rings are driven from this tab's own analyser rather than from the SFU's
 * active-speaker list: the server view is computed on an interval and arrives
 * over the wire, which showed up as the ring lagging behind the voice. The
 * remote analyser sits on the decoded track, so it lights the frame the audio
 * lands.
 */
function isOverSpeakingThreshold(participant: Participant, levelDb: number): boolean {
  if (participant.muted) return false;
  // Deafened means nothing is reaching this tab, so no ring may claim otherwise.
  if (state.outputMuted) return false;

  if (!participant.isLocal) return levelDb >= REMOTE_SPEAKING_DB;
  if (!isGateDisabled()) return levelDb >= state.gateThresholdDb;

  return levelDb >= LOCAL_GATE_DISABLED_SPEAKING_DB;
}

function applySpeaking(participant: Participant, over: boolean): void {
  const now = performance.now();
  if (over) participant.speakingHoldUntil = now + SPEAKING_RELEASE_HOLD_MS;
  const speaking = over || now < participant.speakingHoldUntil;
  if (participant.speaking === speaking) return;
  participant.speaking = speaking;
  bumpParticipantsRevision();
}
