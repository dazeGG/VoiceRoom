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
  type NoiseMode
} from '../core/config';
import { roomDeviceUi } from '$lib/features/room/room-device-ui.svelte';
import { state } from '../core/state.svelte';
import { dbToAmplitude, getNoiseMode, persistMicrophoneVolume } from '../core/settings';
import { showToast } from '../ui/toast';
import { disconnectAudioNode, stopStream } from '../core/utils';
import type { MicProcessor, MicrophoneCapture } from '../core/types';

import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:mic');

type GateNode = AudioNode & { setAuto?: (auto: boolean) => void; setThreshold?: (threshold: number) => void };

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

let rnnoiseModulePromise: Promise<any> | null = null;

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
    if (processor.type === 'gate') processor.setThreshold?.(threshold);
  }
}

export function getGateThresholdAmplitude(): number {
  if (isGateDisabled()) return 0;

  return dbToAmplitude(state.gateThresholdDb);
}

export function setNoiseMode(mode: unknown): void {
  state.noiseMode = getNoiseMode(mode);
  roomDeviceUi.noiseMode = state.noiseMode;
  localStorage.setItem(NOISE_MODE_STORAGE_KEY, state.noiseMode);
}

export async function openMicrophone(mode: NoiseMode = state.noiseMode): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Браузер не дал доступ к микрофону. Нужен HTTPS или localhost.');
  }

  const noiseMode = NOISE_MODES[getNoiseMode(mode)];
  const deviceId = state.microphoneDeviceId || roomDeviceUi.microphoneId;
  const constraints = (exactDeviceId: string): MediaStreamConstraints => ({
    audio: {
      autoGainControl: true,
      channelCount: 1,
      deviceId: exactDeviceId ? { exact: exactDeviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: noiseMode.nativeNoiseSuppression
    },
    video: false
  });
  try {
    return await navigator.mediaDevices.getUserMedia(constraints(deviceId));
  } catch (error) {
    // A stored device that was unplugged (or re-enumerated by the OS) must not
    // leave the user without a microphone: open the system default instead.
    const name = error instanceof DOMException ? error.name : '';
    if (!deviceId || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) throw error;
    log.warn('stored microphone unavailable, opening the default', errorContext(error));
    const stream = await navigator.mediaDevices.getUserMedia(constraints(''));
    showToast('Выбранный микрофон недоступен, включен микрофон по умолчанию');
    return stream;
  }
}

/**
 * Builds the whole capture chain — RNNoise, the gate and the input gain — in
 * one AudioContext. Each MediaStream hop between separate contexts added its
 * own buffering, so the former chain of up to three contexts cost tens of
 * milliseconds of mouth-to-ear latency for nothing.
 */
export async function openLocalMicrophone(): Promise<MicrophoneCapture> {
  const mode = state.noiseMode;
  const rawStream = await openMicrophone(mode);

  if (mode !== 'rnnoise') return buildCapturePipeline(rawStream, mode);

  try {
    return await buildCapturePipeline(rawStream, 'rnnoise');
  } catch (error) {
    log.warn('RNNoise unavailable', errorContext(error));
    stopStream(rawStream);
    setNoiseMode('browser');
    showToast('RNNoise недоступен, включен браузерный шумодав');
    return buildCapturePipeline(await openMicrophone('browser'), 'browser');
  }
}

async function buildCapturePipeline(rawStream: MediaStream, mode: NoiseMode): Promise<MicrophoneCapture> {
  const context = createProcessingAudioContext();
  try {
    const source = context.createMediaStreamSource(rawStream);
    const destination = context.createMediaStreamDestination();
    const processors: MicProcessor[] = [];
    let tail: AudioNode = source;

    if (mode === 'rnnoise') {
      const rnnoise = await createRnnoiseNode(context);
      tail.connect(rnnoise);
      tail = rnnoise;
      processors.push({ context, destination, node: rnnoise, source, type: 'rnnoise' });
    }

    const gate = await createOptionalGateNode(context);
    if (gate) {
      tail.connect(gate);
      tail = gate;
      processors.push({
        context,
        destination,
        node: gate,
        setAuto: (auto: boolean) => gate.setAuto?.(auto),
        setThreshold: (nextThreshold: number) => {
          setNoiseGateNodeThreshold(gate, nextThreshold);
        },
        source,
        type: 'gate'
      });
    }

    processors.push(createInputGainStage(context, tail, destination, source));
    await context.resume();

    const [inputTrack] = rawStream.getAudioTracks();
    const [outputTrack] = destination.stream.getAudioTracks();
    if (!outputTrack) throw new Error('Обработка микрофона не вернула аудио-трек');
    outputTrack.enabled = inputTrack?.enabled ?? true;
    if ('contentHint' in outputTrack) outputTrack.contentHint = 'speech';

    return {
      mode,
      processor: processors,
      rawStream,
      stream: destination.stream
    };
  } catch (error) {
    context.close().catch(() => {});
    // The RNNoise caller owns the raw stream: it closes it before reopening
    // the microphone for the browser fallback.
    if (mode !== 'rnnoise') stopStream(rawStream);
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
  input: AudioNode,
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

  const initial = state.microphoneVolume / 100;
  gain.gain.value = initial;
  input.connect(gain);
  route(initial);

  return {
    context,
    destination,
    node: gain,
    nodes: [gain, limiter],
    setGain: (value: number) => {
      const now = context.currentTime;
      route(value);
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(value, now, 0.01);
    },
    source,
    type: 'input-gain'
  };
}

export function setMicrophoneVolume(volume: number): number {
  const nextVolume = persistMicrophoneVolume(volume);
  state.microphoneVolume = nextVolume;
  roomDeviceUi.microphoneVolume = nextVolume;
  const gain = nextVolume / 100;
  for (const processor of getMicrophoneProcessors(state.micProcessor)) {
    if (processor.type === 'input-gain') processor.setGain?.(gain);
  }
  return nextVolume;
}

async function createOptionalGateNode(context: AudioContext): Promise<GateNode | null> {
  const threshold = getGateThresholdAmplitude();
  if (threshold <= 0) return null;
  try {
    return await createNoiseGateNode(context, threshold);
  } catch (error) {
    log.warn('noise gate unavailable', errorContext(error));
    showToast('Гейт недоступен, микрофон работает без него');
    return null;
  }
}

async function createNoiseGateNode(context: AudioContext, threshold: number): Promise<GateNode> {
  if (window.AudioWorkletNode && context.audioWorklet?.addModule) {
    try {
      await context.audioWorklet.addModule(AUDIO_GATE_WORKLET_URL);
      const node: GateNode = new AudioWorkletNode(context, 'voice-room-noise-gate', {
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: createNoiseGateOptions(threshold)
      });
      node.setThreshold = (nextThreshold: number) => {
        (node as AudioWorkletNode).port.postMessage({ threshold: nextThreshold, type: 'set-threshold' });
      };
      node.setAuto = (auto: boolean) => {
        (node as AudioWorkletNode).port.postMessage({ auto, type: 'set-auto' });
      };
      return node;
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

function createScriptProcessorNoiseGateNode(context: AudioContext, threshold: number): GateNode {
  if (typeof context.createScriptProcessor !== 'function') {
    throw new Error('ScriptProcessor недоступен');
  }

  const gate: GateNode = context.createScriptProcessor(GATE_PROCESSOR_BUFFER_SIZE, 1, 1);
  const envelope = createNoiseGateEnvelope(threshold, context.sampleRate || 48000);
  gate.setThreshold = (nextThreshold: number) => setNoiseGateEnvelopeThreshold(envelope, nextThreshold);
  (gate as ScriptProcessorNode).onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const output = event.outputBuffer.getChannelData(0);

    for (let index = 0; index < input.length; index += 1) {
      output[index] = processNoiseGateSample(input[index] || 0, envelope);
    }
  };

  return gate;
}

function setNoiseGateNodeThreshold(node: GateNode, threshold: number): boolean {
  if (typeof node?.setThreshold === 'function') {
    node.setThreshold(threshold);
    return true;
  }
  return false;
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
    holdSamples: Math.round(GATE_HOLD_MS * sampleRate / 1000),
    open: false,
    releaseCoefficient: getGateSmoothingCoefficient(GATE_RELEASE_MS, sampleRate),
    threshold
  };
}

function processNoiseGateSample(sample: number, envelope: NoiseGateEnvelope): number {
  const level = Math.abs(sample);
  const detectorCoefficient = level > envelope.detector
    ? envelope.detectorAttackCoefficient
    : envelope.detectorReleaseCoefficient;
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
  const gainCoefficient = targetGain > envelope.gain
    ? envelope.attackCoefficient
    : envelope.releaseCoefficient;
  envelope.gain += (targetGain - envelope.gain) * gainCoefficient;

  return sample * envelope.gain;
}

function getGateSmoothingCoefficient(milliseconds: number, sampleRate: number): number {
  const duration = Math.max(0.001, milliseconds / 1000);
  return 1 - Math.exp(-1 / (duration * sampleRate));
}

async function createRnnoiseNode(context: AudioContext): Promise<AudioNode> {
  if (!window.AudioWorkletNode || !context.audioWorklet) {
    throw new Error('AudioWorklet недоступен');
  }
  const { RNNoiseNode, rnnoise_loadAssets: loadAssets } = await loadRnnoiseModule();
  await RNNoiseNode.register(
    context,
    loadAssets({
      moduleSrc: `${RNNOISE_ASSET_BASE}rnnoise.wasm`,
      scriptSrc: `${RNNOISE_ASSET_BASE}rnnoise.worklet.js`
    })
  );
  return new RNNoiseNode(context);
}

function loadRnnoiseModule(): Promise<any> {
  rnnoiseModulePromise ||= import(/* @vite-ignore */ `${RNNOISE_ASSET_BASE}rnnoise.mjs`);
  return rnnoiseModulePromise;
}

export function createProcessingAudioContext(): AudioContext {
  try {
    // 48 kHz is Opus's native rate, so nothing resamples between this chain
    // and the encoder; 'interactive' asks for the smallest render buffer.
    return new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  } catch {
    return new AudioContext({ latencyHint: 'interactive' });
  }
}

export function getLocalMicrophoneCapture(): MicrophoneCapture {
  return {
    processor: state.micProcessor,
    rawStream: state.localRawStream,
    stream: state.localStream
  };
}

export function setLocalMicrophoneCapture(capture: MicrophoneCapture): void {
  state.localStream = capture.stream;
  state.localRawStream = capture.rawStream;
  state.micProcessor = capture.processor;
  roomDeviceUi.microphoneVolume = state.microphoneVolume;
  setMicrophoneCaptureEnabled(capture, !state.muted);
}

export function setMicrophoneCaptureEnabled(capture: MicrophoneCapture, enabled: boolean): void {
  const tracks = new Set([
    ...(capture.stream?.getAudioTracks() || []),
    ...(capture.rawStream?.getAudioTracks() || [])
  ]);
  for (const track of tracks) {
    track.enabled = enabled;
  }
}

export function stopMicrophoneCapture(capture: MicrophoneCapture): void {
  const processors = getMicrophoneProcessors(capture.processor);
  for (const processor of processors) {
    disconnectAudioNode(processor.source);
    disconnectAudioNode(processor.node);
    for (const node of processor.nodes || []) disconnectAudioNode(node);
    disconnectAudioNode(processor.destination);
    processor.context?.close().catch(() => {});
  }

  const streams = new Set(
    [
      capture.stream,
      capture.rawStream,
      ...processors.map((processor) => processor.destination?.stream)
    ].filter((stream): stream is MediaStream => Boolean(stream))
  );
  for (const stream of streams) stopStream(stream);
}

export function getMicrophoneProcessors(processor: MicProcessor | MicProcessor[] | null): MicProcessor[] {
  if (!processor) return [];
  return Array.isArray(processor) ? processor.filter(Boolean) : [processor];
}
