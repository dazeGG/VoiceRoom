import { t } from '@/shared/i18n';
import {
  AUDIO_GATE_WORKLET_URL,
  GATE_ATTACK_MS,
  GATE_CLOSE_RATIO,
  GATE_DETECTOR_ATTACK_MS,
  GATE_DETECTOR_RELEASE_MS,
  GATE_FLOOR_GAIN,
  GATE_HOLD_MS,
  GATE_PROCESSOR_BUFFER_SIZE,
  GATE_RELEASE_MS,
  GATE_THRESHOLD_MIN_DB,
  NOISE_MODES,
  NOISE_MODE_STORAGE_KEY,
  RNNOISE_ASSET_BASE,
  RNNOISE_MODULE_URL,
  RNNOISE_WASM_URL,
  RNNOISE_WORKLET_URL,
  type NoiseMode
} from '../core/config';
import { useRoomDeviceUiStore } from '@/features/room/room-device-ui.store';
import { state } from '../core/room-runtime.store';
import { dbToAmplitude, getNoiseMode, persistMicrophoneVolume } from '../core/settings';
import { showToast } from '../ui/toast';
import { disconnectAudioNode, stopStream } from '../core/utils';
import { isRecord } from '@voice-room/shared/guards';
import { isMicrophoneShownMuted } from '../core/microphone-mute';
import { cancelCaptureProgressObservation } from '../room/mic-send';
import { noteOwnedProcessingTransition } from '../room/capture-diagnostics';
import type { MicProcessor, MicrophoneCapture } from '../core/types';

import { createLogger, errorContext } from '@/shared/log';
import { writeStorage } from '@/shared/storage';

const log = createLogger('room:mic');

/** The gate's node and how to move its threshold: a worklet message or the ScriptProcessor's envelope. */
interface GateStage {
  node: AudioNode;
  setThreshold: (threshold: number) => void;
}

/** What the RNNoise asset module (a static file without typings) exports. */
interface RnnoiseModule {
  RNNoiseNode: {
    register(context: BaseAudioContext, assets: unknown): Promise<void>;
    new (context: BaseAudioContext): AudioWorkletNode;
  };
  rnnoise_loadAssets: (options: { moduleSrc: string; scriptSrc: string }) => unknown;
}

interface NoiseGateEnvelope {
  attackCoefficient: number;
  closeThreshold: number;
  detector: number;
  detectorAttackCoefficient: number;
  detectorReleaseCoefficient: number;
  floorGain: number;
  gain: number;
  holdRemaining: number;
  holdSamples: number;
  open: boolean;
  releaseCoefficient: number;
  threshold: number;
}

let rnnoiseModulePromise: Promise<RnnoiseModule> | null = null;

export function isGateDisabled(): boolean {
  return state.gateThresholdDb <= GATE_THRESHOLD_MIN_DB;
}

/**
 * Holding the push-to-talk key is an explicit "I am talking", so the gate has
 * nothing left to decide: open it fully while the key is held and put the user's
 * threshold back on release. A pipeline built without a gate has nothing to sync.
 */
export function syncPushToTalkGate(): void {
  const threshold = state.pushToTalkActive ? 0 : getGateThresholdAmplitude();
  for (const processor of getMicrophoneProcessors(state.micProcessor)) {
    if (processor.type === 'gate') processor.setThreshold(threshold);
  }
}

export function getGateThresholdAmplitude(): number {
  if (isGateDisabled()) return 0;

  return dbToAmplitude(state.gateThresholdDb);
}

export function setNoiseMode(mode: unknown): void {
  state.noiseMode = getNoiseMode(mode);
  useRoomDeviceUiStore().noiseMode = state.noiseMode;
  writeStorage(NOISE_MODE_STORAGE_KEY, state.noiseMode);
}

async function openMicrophone(
  mode: NoiseMode = state.noiseMode,
  isCurrent: () => boolean = () => true
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(t('Браузер не дал доступ к микрофону. Нужен HTTPS или localhost.'));
  }

  const noiseMode = NOISE_MODES[getNoiseMode(mode)];
  const deviceId = state.microphoneDeviceId || useRoomDeviceUiStore().microphoneId;
  const constraints = (exactDeviceId: string): MediaStreamConstraints => ({
    audio: {
      autoGainControl: true,
      channelCount: 1,
      ...(exactDeviceId ? { deviceId: { exact: exactDeviceId } } : {}),
      echoCancellation: true,
      noiseSuppression: noiseMode.nativeNoiseSuppression
    },
    video: false
  });
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints(deviceId));
    for (const track of stream.getAudioTracks()) track.enabled = false;
    if (!isCurrent()) {
      stopStream(stream);
      throw new Error('Microphone action is stale');
    }
    return stream;
  } catch (error) {
    // A stored device that was unplugged (or re-enumerated by the OS) must not
    // leave the user without a microphone: open the system default instead.
    const name = error instanceof DOMException ? error.name : '';
    if (!deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw error;
    log.warn('stored microphone unavailable, opening the default', errorContext(error));
    const stream = await navigator.mediaDevices.getUserMedia(constraints(''));
    for (const track of stream.getAudioTracks()) track.enabled = false;
    if (!isCurrent()) {
      stopStream(stream);
      throw new Error('Microphone action is stale', { cause: error });
    }
    showToast(t('Выбранный микрофон недоступен, включен микрофон по умолчанию'));
    return stream;
  }
}

let rnnoiseFailedOnPage = false;

/**
 * Builds the whole capture chain — RNNoise, the gate and the input gain — in
 * one AudioContext. Each MediaStream hop between separate contexts added its
 * own buffering, so the former chain of up to three contexts cost tens of
 * milliseconds of mouth-to-ear latency for nothing.
 */
export async function openLocalMicrophone(
  isCurrent: () => boolean = () => true,
  requestedMode: NoiseMode = state.noiseMode
): Promise<MicrophoneCapture> {
  // The saved choice stays RNNoise; once it failed on this page, the browser's
  // own suppression is used directly instead of failing and toasting again.
  const mode = requestedMode === 'rnnoise' && rnnoiseFailedOnPage ? 'browser' : requestedMode;
  const rawStream = await openMicrophone(mode, isCurrent);

  if (mode !== 'rnnoise') return buildCapturePipeline(rawStream, mode, isCurrent);

  try {
    return await buildCapturePipeline(rawStream, 'rnnoise', isCurrent);
  } catch (error) {
    if (!isCurrent()) throw error;
    log.warn('RNNoise unavailable', errorContext(error));
    stopStream(rawStream);
    rnnoiseFailedOnPage = true;
    showToast(t('RNNoise недоступен, включен браузерный шумодав'));
    return buildCapturePipeline(await openMicrophone('browser', isCurrent), 'browser', isCurrent);
  }
}

async function buildCapturePipeline(
  rawStream: MediaStream,
  mode: NoiseMode,
  isCurrent: () => boolean
): Promise<MicrophoneCapture> {
  const context = createProcessingAudioContext();
  let destination: MediaStreamAudioDestinationNode | null = null;
  const processors: MicProcessor[] = [];
  const capture: MicrophoneCapture = {
    barrier: true,
    mode,
    processor: processors,
    rawStream,
    stream: null
  };
  try {
    const source = context.createMediaStreamSource(rawStream);
    destination = context.createMediaStreamDestination();
    capture.stream = destination.stream;
    // Construct the last signal-bearing stage at exact zero before any graph edge.
    const inputGain = createInputGainStage(context, destination, source);
    let tail: AudioNode = source;

    if (mode === 'rnnoise') {
      const rnnoise = await createRnnoiseNode(context, (node) => {
        const onError = () => {
          capture.processorFailed = true;
          if (committedCapture !== capture || capture.barrier || state.localStream !== capture.stream) return;
          void import('../ui/devices').then((devices) => devices.fallbackRnnoiseAfterProcessorError(capture));
        };
        node.addEventListener('processorerror', onError);
        capture.removeProcessorErrorListener = () => node.removeEventListener('processorerror', onError);
      });
      tail.connect(rnnoise);
      tail = rnnoise;
      processors.push({ context, destination, node: rnnoise, source, type: 'rnnoise' });
    }

    const gate = await createOptionalGateNode(context);
    if (gate) {
      tail.connect(gate.node);
      tail = gate.node;
      processors.push({ context, destination, node: gate.node, setThreshold: gate.setThreshold, source, type: 'gate' });
    }

    const silenceFloor = await createOptionalSilenceFloorNode(context);
    if (silenceFloor) {
      tail.connect(silenceFloor);
      tail = silenceFloor;
      processors.push({ context, destination, node: silenceFloor, source, type: 'silence-floor' });
    }

    tail.connect(inputGain.node);
    processors.push(inputGain);
    await context.resume();
    if (!isCurrent()) throw new Error('Microphone action is stale');

    const [outputTrack] = destination.stream.getAudioTracks();
    if (!outputTrack) throw new Error(t('Обработка микрофона не вернула аудио-трек'));
    outputTrack.enabled = false;
    if ('contentHint' in outputTrack) outputTrack.contentHint = 'speech';

    return capture;
  } catch (error) {
    capture.removeProcessorErrorListener?.();
    context.close().catch(() => {});
    if (destination) stopStream(destination.stream);
    // The RNNoise caller owns the raw stream: it closes it before reopening
    // the microphone for the browser fallback.
    stopStream(rawStream);
    throw error;
  }
}

/**
 * The limiter only earns its place above unity gain, where the boost could
 * clip. DynamicsCompressorNode carries a fixed look-ahead delay, so at or
 * below 100% the gain feeds the destination directly and the chain is
 * re-routed only when the user actually boosts the microphone.
 */
function createInputGainStage(
  context: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  source: MediaStreamAudioSourceNode
): MicProcessor {
  const gain = context.createGain();
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;
  limiter.connect(destination);

  let limited: boolean | null = null;
  const route = (value: number) => {
    const needsLimiter = value > 1;
    if (needsLimiter === limited) return;
    if (limited !== null) gain.disconnect();
    gain.connect(needsLimiter ? limiter : destination);
    limited = needsLimiter;
  };

  gain.gain.cancelScheduledValues(context.currentTime);
  gain.gain.setValueAtTime(0, context.currentTime);
  route(0);

  const holdGain = (now: number): void => {
    if (typeof gain.gain.cancelAndHoldAtTime === 'function') {
      gain.gain.cancelAndHoldAtTime(now);
      return;
    }
    const current = gain.gain.value;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(current, now);
  };

  return {
    context,
    destination,
    node: gain,
    nodes: [gain, limiter],
    setGain: (value: number) => {
      const now = context.currentTime;
      route(value);
      holdGain(now);
      gain.gain.setTargetAtTime(value, now, 0.01);
    },
    setHardZero: () => {
      const now = context.currentTime;
      holdGain(now);
      gain.gain.setValueAtTime(0, now);
    },
    source,
    type: 'input-gain'
  };
}

export function setMicrophoneVolume(volume: number): number {
  const nextVolume = persistMicrophoneVolume(volume);
  state.microphoneVolume = nextVolume;
  useRoomDeviceUiStore().microphoneVolume = nextVolume;
  const gain = nextVolume / 100;
  for (const processor of getMicrophoneProcessors(state.micProcessor)) {
    if (
      processor.type === 'input-gain' &&
      state.localStream &&
      !state.muted &&
      !state.outputMuted &&
      (state.microphoneMode !== 'push-to-talk' || state.pushToTalkActive)
    )
      processor.setGain(gain);
  }
  return nextVolume;
}

async function createOptionalGateNode(context: AudioContext): Promise<GateStage | null> {
  const threshold = getGateThresholdAmplitude();
  if (threshold <= 0) return null;
  try {
    return await createNoiseGateNode(context, threshold);
  } catch (error) {
    log.warn('noise gate unavailable', errorContext(error));
    showToast(t('Гейт недоступен, микрофон работает без него'));
    return null;
  }
}

/**
 * Turns the inaudible residue RNNoise or a closed gate leaves into exact zeros,
 * the only input on which Opus DTX stops sending (see audio-gate.worklet.js).
 * Optional: without it the call sounds the same and only uploads its silence.
 */
async function createOptionalSilenceFloorNode(context: AudioContext): Promise<AudioNode | null> {
  if (!window.AudioWorkletNode || !context.audioWorklet?.addModule) return null;
  try {
    await context.audioWorklet.addModule(AUDIO_GATE_WORKLET_URL);
    return new AudioWorkletNode(context, 'voice-room-silence-floor', {
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    });
  } catch (error) {
    log.warn('silence floor unavailable', errorContext(error));
    return null;
  }
}

async function createNoiseGateNode(context: AudioContext, threshold: number): Promise<GateStage> {
  if (window.AudioWorkletNode && context.audioWorklet?.addModule) {
    try {
      await context.audioWorklet.addModule(AUDIO_GATE_WORKLET_URL);
      const node = new AudioWorkletNode(context, 'voice-room-noise-gate', {
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: createNoiseGateOptions(threshold)
      });
      return {
        node,
        setThreshold: (nextThreshold: number) => {
          node.port.postMessage({ threshold: nextThreshold, type: 'set-threshold' });
        }
      };
    } catch (error) {
      log.warn('AudioWorklet gate unavailable, using ScriptProcessor', errorContext(error));
    }
  }

  return createScriptProcessorNoiseGateNode(context, threshold);
}

function createNoiseGateOptions(threshold: number) {
  return {
    attackMs: GATE_ATTACK_MS,
    closeRatio: GATE_CLOSE_RATIO,
    detectorAttackMs: GATE_DETECTOR_ATTACK_MS,
    detectorReleaseMs: GATE_DETECTOR_RELEASE_MS,
    floorGain: GATE_FLOOR_GAIN,
    holdMs: GATE_HOLD_MS,
    releaseMs: GATE_RELEASE_MS,
    threshold
  };
}

function createScriptProcessorNoiseGateNode(context: AudioContext, threshold: number): GateStage {
  if (typeof context.createScriptProcessor !== 'function') {
    throw new Error(t('ScriptProcessor недоступен'));
  }

  const gate = context.createScriptProcessor(GATE_PROCESSOR_BUFFER_SIZE, 1, 1);
  const envelope = createNoiseGateEnvelope(threshold, context.sampleRate || 48000);
  gate.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);

    for (let index = 0; index < input.length; index += 1) {
      output[index] = processNoiseGateSample(input[index] || 0, envelope);
    }
  };

  return {
    node: gate,
    setThreshold: (nextThreshold: number) => setNoiseGateEnvelopeThreshold(envelope, nextThreshold)
  };
}

function setNoiseGateEnvelopeThreshold(envelope: NoiseGateEnvelope, threshold: number): void {
  envelope.threshold = Math.max(0, Number(threshold) || 0);
  envelope.closeThreshold = envelope.threshold * GATE_CLOSE_RATIO;
  if (envelope.threshold <= 0) {
    envelope.open = true;
    envelope.holdRemaining = envelope.holdSamples;
  }
}

function createNoiseGateEnvelope(threshold: number, sampleRate: number): NoiseGateEnvelope {
  return {
    attackCoefficient: getGateSmoothingCoefficient(GATE_ATTACK_MS, sampleRate),
    closeThreshold: threshold * GATE_CLOSE_RATIO,
    detector: 0,
    detectorAttackCoefficient: getGateSmoothingCoefficient(GATE_DETECTOR_ATTACK_MS, sampleRate),
    detectorReleaseCoefficient: getGateSmoothingCoefficient(GATE_DETECTOR_RELEASE_MS, sampleRate),
    floorGain: GATE_FLOOR_GAIN,
    gain: threshold > 0 ? GATE_FLOOR_GAIN : 1,
    holdRemaining: 0,
    holdSamples: Math.round((GATE_HOLD_MS * sampleRate) / 1000),
    open: false,
    releaseCoefficient: getGateSmoothingCoefficient(GATE_RELEASE_MS, sampleRate),
    threshold
  };
}

function processNoiseGateSample(sample: number, envelope: NoiseGateEnvelope): number {
  const level = Math.abs(sample);
  const detectorCoefficient =
    level > envelope.detector ? envelope.detectorAttackCoefficient : envelope.detectorReleaseCoefficient;
  envelope.detector += (level - envelope.detector) * detectorCoefficient;

  if (envelope.detector >= envelope.threshold) {
    envelope.open = true;
    envelope.holdRemaining = envelope.holdSamples;
  } else if (envelope.open && envelope.detector < envelope.closeThreshold) {
    if (envelope.holdRemaining > 0) {
      envelope.holdRemaining -= 1;
    } else {
      envelope.open = false;
    }
  }

  const targetGain = envelope.open ? 1 : envelope.floorGain;
  const gainCoefficient = targetGain > envelope.gain ? envelope.attackCoefficient : envelope.releaseCoefficient;
  envelope.gain += (targetGain - envelope.gain) * gainCoefficient;

  return sample * envelope.gain;
}

function getGateSmoothingCoefficient(milliseconds: number, sampleRate: number): number {
  const duration = Math.max(0.001, milliseconds / 1000);
  return 1 - Math.exp(-1 / (duration * sampleRate));
}

async function createRnnoiseNode(context: AudioContext, onCreated: (node: AudioNode) => void): Promise<AudioNode> {
  if (!window.AudioWorkletNode || !context.audioWorklet) {
    throw new Error(t('AudioWorklet недоступен'));
  }
  const { RNNoiseNode, rnnoise_loadAssets: loadAssets } = await loadRnnoiseModule();
  await RNNoiseNode.register(
    context,
    loadAssets({
      moduleSrc: RNNOISE_WASM_URL,
      scriptSrc: RNNOISE_WORKLET_URL
    })
  );
  const node = new RNNoiseNode(context);
  onCreated(node);
  return node;
}

function importRnnoiseModule(): Promise<unknown> {
  // The dev server adds ?import to any address it cannot read as a .mjs file, then
  // refuses a file of public/ asked for that way and covers the page with an error.
  if (import.meta.env.DEV) return import(/* @vite-ignore */ `${RNNOISE_ASSET_BASE}rnnoise.mjs`);
  return import(/* @vite-ignore */ RNNOISE_MODULE_URL);
}

function loadRnnoiseModule(): Promise<RnnoiseModule> {
  rnnoiseModulePromise ||= importRnnoiseModule().then((module: unknown) => {
    if (!isRnnoiseModule(module)) throw new Error('RNNoise module has an unexpected shape');
    return module;
  });
  return rnnoiseModulePromise;
}

function isRnnoiseModule(value: unknown): value is RnnoiseModule {
  return isRecord(value) && typeof value.RNNoiseNode === 'function' && typeof value.rnnoise_loadAssets === 'function';
}

function createProcessingAudioContext(): AudioContext {
  try {
    // 48 kHz is Opus's native rate, so nothing resamples between this chain
    // and the encoder; 'interactive' asks for the smallest render buffer.
    return new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  } catch {
    return new AudioContext({ latencyHint: 'interactive' });
  }
}

/** Why the microphone could not be opened, for a listener who joins without one. */
export function describeMicrophoneError(error: unknown): string {
  const name = isRecord(error) ? error.name : undefined;
  if (name === 'NotAllowedError' || name === 'SecurityError') return t('Нет доступа к микрофону');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return t('Микрофон не найден');
  if (name === 'NotReadableError' || name === 'AbortError') return t('Микрофон занят другим приложением');
  return t('Микрофон недоступен');
}

export function getLocalMicrophoneCapture(): MicrophoneCapture {
  if (committedCapture?.stream && committedCapture.stream === state.localStream) return committedCapture;
  return {
    processor: state.micProcessor,
    rawStream: state.localRawStream,
    stream: state.localStream
  };
}

/** Muting disables tracks without ending them; only terminal source/output loss rejects a prepared capture. */
export function isMicrophoneCaptureLive(capture: MicrophoneCapture): boolean {
  const raw = capture.rawStream?.getAudioTracks()[0];
  const output = capture.stream?.getAudioTracks()[0];
  return raw?.readyState === 'live' && output?.readyState === 'live';
}

/** Scalar, device-id-free facts about the committed capture for existing stats polls. */
export function getMicrophoneCaptureDiagnostics(): {
  contextState: string | null;
  desiredMode: NoiseMode;
  actualMode: NoiseMode | null;
  rawState: string | null;
  rawMuted: boolean | null;
  rawEnabled: boolean | null;
  outputState: string | null;
} {
  const raw = state.localRawStream?.getAudioTracks()[0];
  const output = state.localStream?.getAudioTracks()[0];
  return {
    contextState: state.micProcessor?.[0]?.context.state ?? null,
    desiredMode: state.noiseMode,
    actualMode: committedCapture?.stream === state.localStream ? (committedCapture.mode ?? null) : null,
    rawState: raw?.readyState ?? null,
    rawMuted: raw?.muted ?? null,
    rawEnabled: raw?.enabled ?? null,
    outputState: output?.readyState ?? null
  };
}

let committedCapture: MicrophoneCapture | null = null;

export function setLocalMicrophoneCapture(capture: MicrophoneCapture): void {
  cancelCaptureProgressObservation();
  committedCapture = capture;
  state.localStream = capture.stream;
  state.localRawStream = capture.rawStream;
  state.micProcessor = capture.processor;
  useRoomDeviceUiStore().microphoneVolume = state.microphoneVolume;
  capture.barrier = false;
  setMicrophoneCaptureEnabled(capture, !state.muted && !state.outputMuted);
  syncMicrophoneProcessing();
}

/**
 * A muted microphone sends nothing, yet RNNoise and the gate went on processing
 * every sample of it. After a few seconds of a real mute (the button or deafen)
 * the capture's AudioContext is suspended; unmuting resumes it in tens of
 * milliseconds. Push-to-talk with the key up is not a mute: its capture keeps
 * running so the first word after a key press is never clipped.
 */
export const PROCESSING_SUSPEND_DELAY_MS = 3000;
/** A context we suspended that is not running again by then gets a fresh capture. */
export const PROCESSING_RESUME_CHECK_MS = 1500;

let processingSuspendTimer = 0;
const suspendedContexts = new WeakSet<AudioContext>();

export function isMicrophoneProcessingIdle(): boolean {
  return state.muted && isMicrophoneShownMuted();
}

export function syncMicrophoneProcessing(): void {
  window.clearTimeout(processingSuspendTimer);
  processingSuspendTimer = 0;
  const processor = state.micProcessor;
  const context = getMicrophoneProcessors(processor)[0]?.context;
  if (!context || context.state === 'closed') return;

  if (!isMicrophoneProcessingIdle()) {
    // Only a context this module suspended is resumed here: anything else
    // keeps the capture's own start-up behaviour.
    if (suspendedContexts.has(context)) resumeMicrophoneProcessing(processor, context);
    return;
  }

  processingSuspendTimer = window.setTimeout(() => {
    processingSuspendTimer = 0;
    if (state.micProcessor !== processor || !isMicrophoneProcessingIdle() || context.state !== 'running') return;
    suspendedContexts.add(context);
    noteOwnedProcessingTransition('suspended');
    context.suspend().catch((error: unknown) => log.warn('microphone processing suspend failed', errorContext(error)));
  }, PROCESSING_SUSPEND_DELAY_MS);
}

function resumeMicrophoneProcessing(processor: MicrophoneCapture['processor'], context: AudioContext): void {
  suspendedContexts.delete(context);
  // Resolves after any suspend still in flight, so a quick unmute wins.
  noteOwnedProcessingTransition('running');
  context.resume().catch((error: unknown) => log.warn('microphone processing resume failed', errorContext(error)));
  window.setTimeout(() => {
    if (state.micProcessor !== processor || isMicrophoneProcessingIdle() || context.state === 'running') return;
    log.warn('microphone processing did not resume', { contextState: context.state });
    void import('../ui/devices')
      .then((devices) => devices.reopenMicrophoneAfterOwnedResumeFailure())
      .catch((error: unknown) => log.warn('microphone reopen failed', errorContext(error)));
  }, PROCESSING_RESUME_CHECK_MS);
}

export function setMicrophoneCaptureEnabled(capture: MicrophoneCapture, enabled: boolean): void {
  const permitted =
    enabled &&
    !capture.barrier &&
    !state.outputMuted &&
    (state.microphoneMode !== 'push-to-talk' || state.pushToTalkActive);
  for (const stage of getMicrophoneProcessors(capture.processor)) {
    if (stage.type === 'input-gain') {
      if (permitted) stage.setGain(state.microphoneVolume / 100);
      else stage.setHardZero();
    }
  }
  const tracks = new Set([...(capture.stream?.getAudioTracks() || []), ...(capture.rawStream?.getAudioTracks() || [])]);
  for (const track of tracks) {
    track.enabled = permitted;
  }
  if (permitted && capture.processorFailed && committedCapture === capture) {
    void import('../ui/devices').then((devices) => devices.fallbackRnnoiseAfterProcessorError(capture));
  }
}

export function stopMicrophoneCapture(capture: MicrophoneCapture): void {
  capture.removeProcessorErrorListener?.();
  delete capture.removeProcessorErrorListener;
  delete capture.processorFailed;
  capture.removeRawEndedListener?.();
  delete capture.removeRawEndedListener;
  if (committedCapture?.stream && committedCapture.stream === capture.stream) committedCapture = null;
  const processors = getMicrophoneProcessors(capture.processor);
  const contexts = new Set<AudioContext>();
  for (const processor of processors) {
    disconnectAudioNode(processor.source);
    disconnectAudioNode(processor.node);
    if (processor.type === 'input-gain') for (const node of processor.nodes) disconnectAudioNode(node);
    disconnectAudioNode(processor.destination);
    contexts.add(processor.context);
  }
  // Every stage of one capture shares a single context.
  for (const context of contexts) context.close().catch(() => {});

  const streams = new Set(
    [capture.stream, capture.rawStream, ...processors.map((processor) => processor.destination?.stream)].filter(
      (stream): stream is MediaStream => Boolean(stream)
    )
  );
  for (const stream of streams) stopStream(stream);
}

export function getMicrophoneProcessors(processor: MicProcessor[] | null): MicProcessor[] {
  return processor || [];
}
