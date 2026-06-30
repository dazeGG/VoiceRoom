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
import { dbToAmplitude, getNoiseMode } from '../core/settings';
import { showToast } from '../ui/toast';
import { disconnectAudioNode, stopStream } from '../core/utils';
import type { MicProcessor, MicrophoneCapture } from '../core/types';

type GateNode = AudioNode & { setThreshold?: (threshold: number) => void };

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
  return navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      channelCount: 1,
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: noiseMode.nativeNoiseSuppression
    },
    video: false
  });
}

export async function openLocalMicrophone(): Promise<MicrophoneCapture> {
  const mode = state.noiseMode;
  const rawStream = await openMicrophone(mode);

  if (mode !== 'rnnoise') {
    return applyNoiseGateToCapture({
      mode,
      processor: null,
      rawStream,
      stream: rawStream
    });
  }

  try {
    return await applyNoiseGateToCapture(await createNoiseSuppressedStream(rawStream));
  } catch (error) {
    console.warn('RNNoise unavailable', error);
    stopStream(rawStream);
    setNoiseMode('browser');
    showToast('RNNoise недоступен, включен браузерный шумодав');
    const fallbackStream = await openMicrophone('browser');
    return applyNoiseGateToCapture({
      mode: 'browser',
      processor: null,
      rawStream: fallbackStream,
      stream: fallbackStream
    });
  }
}

async function applyNoiseGateToCapture(capture: MicrophoneCapture): Promise<MicrophoneCapture> {
  if (getGateThresholdAmplitude() <= 0) return capture;

  try {
    const gated = await createNoiseGatedStream(capture.stream!);
    return {
      ...capture,
      processor: combineMicrophoneProcessors(capture.processor, gated.processor),
      stream: gated.stream
    };
  } catch (error) {
    console.warn('Noise gate unavailable', error);
    showToast('Гейт недоступен, микрофон работает без него');
    return capture;
  }
}

async function createNoiseGatedStream(inputStream: MediaStream): Promise<{
  kind?: string;
  processor: MicProcessor | null;
  stream: MediaStream;
}> {
  const threshold = getGateThresholdAmplitude();
  if (threshold <= 0) {
    return {
      processor: null,
      stream: inputStream
    };
  }

  const context = createProcessingAudioContext();
  try {
    const source = context.createMediaStreamSource(inputStream);
    const gate = await createNoiseGateNode(context, threshold);
    const destination = context.createMediaStreamDestination();

    source.connect(gate);
    gate.connect(destination);
    await context.resume();

    const [inputTrack] = inputStream.getAudioTracks();
    const [outputTrack] = destination.stream.getAudioTracks();
    if (!outputTrack) {
      throw new Error('Гейт не вернул аудио-трек');
    }
    outputTrack.enabled = inputTrack?.enabled ?? true;
    if ('contentHint' in outputTrack) outputTrack.contentHint = 'speech';

    return {
      kind: 'gate',
      processor: {
        context,
        destination,
        node: gate,
        setThreshold: (nextThreshold: number) => {
          setNoiseGateNodeThreshold(gate, nextThreshold);
        },
        source,
        type: 'gate'
      },
      stream: destination.stream
    };
  } catch (error) {
    context.close().catch(() => {});
    throw error;
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
      return node;
    } catch (error) {
      console.warn('AudioWorklet gate unavailable, using ScriptProcessor', error);
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

async function createNoiseSuppressedStream(rawStream: MediaStream): Promise<MicrophoneCapture> {
  if (!window.AudioContext || !window.AudioWorkletNode) {
    throw new Error('AudioWorklet недоступен');
  }

  const context = createProcessingAudioContext();
  try {
    const { RNNoiseNode, rnnoise_loadAssets: loadAssets } = await loadRnnoiseModule();
    await RNNoiseNode.register(
      context,
      loadAssets({
        moduleSrc: `${RNNOISE_ASSET_BASE}rnnoise.wasm`,
        scriptSrc: `${RNNOISE_ASSET_BASE}rnnoise.worklet.js`
      })
    );

    const source = context.createMediaStreamSource(rawStream);
    const rnnoise = new RNNoiseNode(context);
    const destination = context.createMediaStreamDestination();
    source.connect(rnnoise);
    rnnoise.connect(destination);
    await context.resume();

    const [inputTrack] = rawStream.getAudioTracks();
    const [outputTrack] = destination.stream.getAudioTracks();
    if (!outputTrack) {
      throw new Error('RNNoise не вернул аудио-трек');
    }
    outputTrack.enabled = inputTrack?.enabled ?? true;
    if ('contentHint' in outputTrack) outputTrack.contentHint = 'speech';

    return {
      mode: 'rnnoise',
      processor: {
        context,
        destination,
        node: rnnoise,
        source
      },
      rawStream,
      stream: destination.stream
    };
  } catch (error) {
    context.close().catch(() => {});
    throw error;
  }
}

function loadRnnoiseModule(): Promise<any> {
  rnnoiseModulePromise ||= import(/* @vite-ignore */ `${RNNOISE_ASSET_BASE}rnnoise.mjs`);
  return rnnoiseModulePromise;
}

export function createProcessingAudioContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: 48000 });
  } catch {
    return new AudioContext();
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

function combineMicrophoneProcessors(
  currentProcessor: MicProcessor | MicProcessor[] | null,
  nextProcessor: MicProcessor | null
): MicProcessor | MicProcessor[] | null {
  if (!currentProcessor) return nextProcessor;
  return [...getMicrophoneProcessors(currentProcessor), nextProcessor].filter(
    (processor): processor is MicProcessor => Boolean(processor)
  );
}

export function getMicrophoneProcessors(processor: MicProcessor | MicProcessor[] | null): MicProcessor[] {
  if (!processor) return [];
  return Array.isArray(processor) ? processor.filter(Boolean) : [processor];
}
