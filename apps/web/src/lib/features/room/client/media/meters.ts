import { roomDeviceUi } from '$lib/features/room/room-device-ui.svelte';
import {
  AUDIO_GATE_WORKLET_URL,
  GATE_THRESHOLD_MIN_DB,
  LOCAL_GATE_DISABLED_SPEAKING_DB,
  REMOTE_SPEAKING_DB,
  SPEAKING_RELEASE_HOLD_MS
} from '../core/config';
import { state } from '../core/state.svelte';
import { amplitudeToDb } from '../core/settings';
import { isRecord } from '@voice-room/shared/guards';
import { getSharedAudioContext } from '../services/media-playback-service';
import { isGateDisabled } from '../services/microphone-service';
import type { Participant } from '../core/types';

import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:meters');

/**
 * Both rings are driven from this tab's own audio rather than from the SFU's
 * active-speaker list: the server view is computed on an interval and arrives
 * over the wire, which showed up as the ring lagging behind the voice.
 *
 * Each voice gets a speaking detector on the audio thread
 * (audio-gate.worklet.js) that reports only when it starts or stops hearing
 * voice, so the page does nothing while nobody talks and the ring follows the
 * audio within one 2.7 ms block. Without AudioWorklet an analyser is polled
 * instead, at this interval.
 */
export const METER_INTERVAL_MS = 33;
const SPEAKING_DETECTOR = 'voice-room-speaking-detector';

/** One participant's meter: the source node and the detector (or analyser) behind it. */
export class VoiceMeter {
  detector: AudioWorkletNode | null = null;
  disposed = false;

  constructor(
    readonly source: MediaStreamAudioSourceNode,
    readonly track: MediaStreamTrack | null
  ) {}

  dispose(): void {
    this.disposed = true;
    if (this.detector) this.detector.port.onmessage = null;
    for (const node of [this.source, this.detector]) {
      try {
        node?.disconnect();
      } catch {
        // Already disconnected.
      }
    }
  }
}

const meters = new Set<VoiceMeter>();
const detectorModules = new WeakMap<BaseAudioContext, Promise<void>>();
let metersRunning = false;
let fallbackTimer = 0;
let levelReporting = false;

function refreshMicrophoneLevelMeterSoon(levelDb: number): void {
  void import('../ui/devices').then((module) => module.refreshMicrophoneLevelMeter(levelDb));
}

function speakingThresholdDb(participant: Participant): number {
  if (!participant.isLocal) return REMOTE_SPEAKING_DB;
  return isGateDisabled() ? LOCAL_GATE_DISABLED_SPEAKING_DB : state.gateThresholdDb;
}

function loadDetectorModule(context: AudioContext): Promise<void> {
  let loading = detectorModules.get(context);
  if (!loading) {
    loading = context.audioWorklet.addModule(AUDIO_GATE_WORKLET_URL);
    detectorModules.set(context, loading);
  }
  return loading;
}

function canUseDetector(context: AudioContext): boolean {
  return typeof AudioWorkletNode === 'function' && typeof context.audioWorklet?.addModule === 'function';
}

export function attachMeter(participant: Participant | null, stream: MediaStream | null): void {
  if (!participant || !stream) return;
  detachMeter(participant);

  let context: AudioContext;
  let meter: VoiceMeter;
  try {
    context = getSharedAudioContext();
    meter = new VoiceMeter(context.createMediaStreamSource(stream), stream.getAudioTracks()[0] ?? null);
  } catch (error) {
    log.warn('audio meter unavailable', errorContext(error));
    return;
  }
  participant.meter = meter;
  meters.add(meter);

  if (!canUseDetector(context)) {
    attachAnalyser(participant, meter, context);
    return;
  }

  loadDetectorModule(context)
    .then(() => {
      if (meter.disposed) return;
      const detector = new AudioWorkletNode(context, SPEAKING_DETECTOR, {
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        numberOfInputs: 1,
        numberOfOutputs: 0,
        processorOptions: { holdMs: SPEAKING_RELEASE_HOLD_MS, thresholdDb: speakingThresholdDb(participant) }
      });
      detector.port.onmessage = (event: MessageEvent<unknown>) => handleDetectorMessage(participant, meter, event.data);
      meter.source.connect(detector);
      meter.detector = detector;
      if (participant.isLocal && levelReporting) detector.port.postMessage({ type: 'report-level', enabled: true });
    })
    .catch((error: unknown) => {
      log.warn('speaking detector unavailable, polling the level instead', errorContext(error));
      if (!meter.disposed) attachAnalyser(participant, meter, context);
    });
}

/** Stops a participant's meter: its tile is gone or a new track replaces it. */
export function detachMeter(participant: Participant | null): void {
  const meter = participant?.meter;
  if (!participant || !meter) return;
  meter.dispose();
  meters.delete(meter);
  participant.meter = null;
  participant.voiceDetected = false;
  participant.analyser = null;
  participant.meterData = null;
  syncFallbackTimer();
}

function attachAnalyser(participant: Participant, meter: VoiceMeter, context: AudioContext): void {
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  meter.source.connect(analyser);
  participant.analyser = analyser;
  participant.meterData = new Uint8Array(analyser.frequencyBinCount);
  syncFallbackTimer();
}

function handleDetectorMessage(participant: Participant, meter: VoiceMeter, data: unknown): void {
  if (meter.disposed || participant.meter !== meter || !isRecord(data)) return;
  const message = data;
  if (message.type === 'speaking') {
    participant.voiceDetected = message.speaking === true;
    refreshSpeaking(participant);
    return;
  }
  if (message.type === 'level' && participant.isLocal && levelReporting) {
    refreshMicrophoneLevelMeterSoon(participant.muted ? GATE_THRESHOLD_MIN_DB : Number(message.db));
  }
}

/** True when this tab hears the participant's voice itself (detector or analyser). */
export function hasVoiceMeter(participant: Participant | null): boolean {
  return Boolean(participant?.meter?.detector || participant?.analyser);
}

/**
 * Re-applies the ring of a detector-driven participant after a rule changed:
 * a mute, deafen or push-to-talk. Polled and server-driven rings re-apply
 * themselves.
 */
export function refreshSpeaking(participant: Participant | null): void {
  if (!participant?.meter?.detector) return;
  setRing(participant, isRingLit(participant, participant.voiceDetected));
}

export function refreshAllSpeaking(): void {
  refreshSpeaking(state.self);
  for (const peer of state.peers.values()) refreshSpeaking(peer);
}

/** The local detector's threshold follows the gate (see speakingThresholdDb). */
export function syncSpeakingThresholds(): void {
  const self = state.self;
  self?.meter?.detector?.port.postMessage({ type: 'set-threshold', thresholdDb: speakingThresholdDb(self) });
}

/** The microphone popover shows a live level only while it is open. */
export function setMicrophoneLevelReporting(enabled: boolean): void {
  if (levelReporting === enabled) return;
  levelReporting = enabled;
  state.self?.meter?.detector?.port.postMessage({ type: 'report-level', enabled });
}

export function startMeters(): void {
  metersRunning = true;
  syncFallbackTimer();
}

export function stopMeters(): void {
  metersRunning = false;
  syncFallbackTimer();
  for (const meter of meters) meter.dispose();
  meters.clear();
}

function hasPolledMeters(): boolean {
  if (state.self?.analyser) return true;
  for (const peer of state.peers.values()) if (peer.analyser) return true;
  return false;
}

// The fallback timer runs only while some participant has an analyser instead
// of a detector, so with AudioWorklet available nothing polls at all.
function syncFallbackTimer(): void {
  const wanted = metersRunning && hasPolledMeters();
  if (wanted && !fallbackTimer) {
    fallbackTimer = window.setInterval(pollAnalysers, METER_INTERVAL_MS);
  } else if (!wanted && fallbackTimer) {
    window.clearInterval(fallbackTimer);
    fallbackTimer = 0;
  }
}

function pollAnalysers(): void {
  updatePolledMeter(state.self);
  for (const peer of state.peers.values()) updatePolledMeter(peer);
  syncFallbackTimer();
}

function updatePolledMeter(participant: Participant | null): void {
  if (!participant?.analyser || !participant.meterData) return;

  participant.analyser.getByteTimeDomainData(participant.meterData);
  let sum = 0;
  for (const value of participant.meterData) {
    const centered = value - 128;
    sum += centered * centered;
  }

  const rms = Math.sqrt(sum / participant.meterData.length);
  const levelDb = amplitudeToDb(Math.min(1, rms / 128));
  const visibleLevelDb = participant.muted ? GATE_THRESHOLD_MIN_DB : levelDb;
  if (participant.isLocal && roomDeviceUi.devicePopoverOpen) {
    refreshMicrophoneLevelMeterSoon(visibleLevelDb);
  }
  applyPolledSpeaking(participant, isRingLit(participant, levelDb >= speakingThresholdDb(participant)));
}

function isRingLit(participant: Participant, voice: boolean): boolean {
  if (participant.muted) return false;
  // Deafened means nothing is reaching this tab, so no ring may claim otherwise.
  if (state.outputMuted) return false;
  if (participant.isLocal && state.microphoneMode === 'push-to-talk') return state.pushToTalkActive;
  return voice;
}

function applyPolledSpeaking(participant: Participant, over: boolean): void {
  const now = performance.now();
  if (over) participant.speakingHoldUntil = now + SPEAKING_RELEASE_HOLD_MS;
  setRing(participant, over || now < participant.speakingHoldUntil);
}

function setRing(participant: Participant, speaking: boolean): void {
  if (participant.speaking === speaking) return;
  participant.speaking = speaking;
}
