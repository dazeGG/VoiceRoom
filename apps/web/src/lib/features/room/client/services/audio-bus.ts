import { state } from '../core/state.svelte';
import { OUTPUT_DEVICE_STORAGE_KEY } from '../core/config';
import { getNotificationVolumeMultiplier, getStoredMasterVolume } from '../core/settings';

type AudioBusKind = 'voice' | 'media' | 'sfx';

interface AudioBusGraph {
  context: AudioContext;
  limiter: DynamicsCompressorNode;
  master: GainNode;
  media: GainNode;
  sfx: GainNode;
  voice: GainNode;
}

interface RoutedSource {
  bus: AudioBusKind;
  gain: GainNode;
  source: MediaStreamAudioSourceNode;
  stream: MediaStream;
}

const routedSources = new WeakMap<HTMLMediaElement, RoutedSource>();
let graph: AudioBusGraph | null = null;
let sinkDestination: MediaStreamAudioDestinationNode | null = null;
let sinkElement: HTMLAudioElement | null = null;
let outputSyncPromise: Promise<boolean> = Promise.resolve(true);

function supportsContextSink(): boolean {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
}

function supportsElementSink(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

function createGraph(): AudioBusGraph {
  const context = (state.audioContext ||= new AudioContext());
  const voice = context.createGain();
  const media = context.createGain();
  const sfx = context.createGain();
  const master = context.createGain();
  const limiter = context.createDynamicsCompressor();

  limiter.threshold.value = -3;
  limiter.knee.value = 12;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  voice.connect(master);
  media.connect(master);
  sfx.connect(master);
  master.connect(limiter);
  limiter.connect(context.destination);

  graph = { context, limiter, master, media, sfx, voice };
  syncAudioBusSettings();
  const initialSinkId = state.outputDeviceId || '';
  void syncAudioBusOutput(initialSinkId).then(async (synced) => {
    if (synced || !initialSinkId || state.outputDeviceId !== initialSinkId) return;
    state.outputDeviceId = '';
    try {
      localStorage.removeItem(OUTPUT_DEVICE_STORAGE_KEY);
    } catch {
      // The runtime still recovers to system output when storage is unavailable.
    }
    await syncAudioBusOutput('');
  });
  return graph;
}

export function getAudioBusGraph(): AudioBusGraph {
  return graph || createGraph();
}

export function getSharedAudioContext(): AudioContext {
  return getAudioBusGraph().context;
}

export function getAudioBusInput(kind: AudioBusKind): AudioNode {
  return getAudioBusGraph()[kind];
}

export function syncAudioBusSettings(options: { muteDelayMs?: number } = {}): void {
  if (!graph) return;
  graph.sfx.gain.value = getNotificationVolumeMultiplier();
  const now = graph.context.currentTime;
  const muted = state.outputMuted || state.localAppAudioSuppressed;
  const muteDelayMs = muted ? Math.max(0, options.muteDelayMs || 0) : 0;
  graph.master.gain.cancelScheduledValues(now);
  if (muteDelayMs > 0) {
    graph.master.gain.setValueAtTime(graph.master.gain.value, now);
    graph.master.gain.setValueAtTime(0, now + muteDelayMs / 1000);
    return;
  }
  graph.master.gain.setValueAtTime(muted ? 0 : getStoredMasterVolume() / 100, now);
}

function removeSinkElement(): void {
  sinkElement?.pause();
  if (sinkElement) sinkElement.srcObject = null;
  sinkElement?.remove();
  sinkElement = null;
  sinkDestination = null;
}

function connectDefaultOutput(current: AudioBusGraph): void {
  current.limiter.disconnect();
  current.limiter.connect(current.context.destination);
  removeSinkElement();
}

async function applyAudioBusOutput(sinkId: string): Promise<boolean> {
  const current = getAudioBusGraph();

  if (supportsContextSink()) {
    connectDefaultOutput(current);
    try {
      await (current.context as AudioContext & { setSinkId: (id: string) => Promise<void> }).setSinkId(sinkId);
      return true;
    } catch (error) {
      console.warn('Audio context output device unavailable', error);
      if (sinkId) {
        current.limiter.disconnect();
        removeSinkElement();
      }
      return false;
    }
  }

  if (supportsElementSink()) {
    sinkDestination ||= current.context.createMediaStreamDestination();
    sinkElement ||= document.createElement('audio');
    sinkElement.autoplay = true;
    (sinkElement as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
    sinkElement.srcObject = sinkDestination.stream;
    if (!sinkElement.isConnected) document.body.append(sinkElement);
    current.limiter.disconnect();
    current.limiter.connect(sinkDestination);
    try {
      await sinkElement.setSinkId(sinkId);
    } catch (error) {
      console.warn('Audio element output device unavailable', error);
      if (sinkId) {
        current.limiter.disconnect();
        removeSinkElement();
      } else {
        connectDefaultOutput(current);
      }
      return false;
    }

    try {
      await sinkElement.play();
    } catch (error) {
      console.warn('Audio element playback requires a user gesture', error);
      state.audioUnlockPending = true;
    }
    return true;
  }

  connectDefaultOutput(current);
  return !sinkId;
}

export function syncAudioBusOutput(requestedId = state.outputDeviceId || ''): Promise<boolean> {
  const applyRequestedOutput = () => applyAudioBusOutput(requestedId);
  outputSyncPromise = outputSyncPromise.then(applyRequestedOutput, applyRequestedOutput);
  return outputSyncPromise;
}

function busNode(current: AudioBusGraph, kind: AudioBusKind): GainNode {
  return current[kind];
}

export function routeMediaStreamElement(
  mediaElement: HTMLMediaElement,
  kind: AudioBusKind,
  options: { muted: boolean; volume: number }
): boolean {
  const stream = mediaElement.srcObject instanceof MediaStream ? mediaElement.srcObject : null;
  const hasLiveAudio = Boolean(stream?.getAudioTracks().some((track) => track.readyState !== 'ended'));
  if (!stream || !hasLiveAudio) {
    releaseMediaStreamElement(mediaElement);
    mediaElement.muted = true;
    return false;
  }

  const current = getAudioBusGraph();
  let routed = routedSources.get(mediaElement);
  if (!routed || routed.stream !== stream || routed.bus !== kind) {
    releaseMediaStreamElement(mediaElement);
    const source = current.context.createMediaStreamSource(stream);
    const gain = current.context.createGain();
    source.connect(gain);
    gain.connect(busNode(current, kind));
    routed = { bus: kind, gain, source, stream };
    routedSources.set(mediaElement, routed);
  }

  const volume = Number.isFinite(options.volume) ? Math.min(2, Math.max(0, options.volume)) : 1;
  routed.gain.gain.value = options.muted ? 0 : volume;
  mediaElement.volume = 1;
  mediaElement.muted = true;
  return true;
}

export function releaseMediaStreamElement(mediaElement: HTMLMediaElement): void {
  const routed = routedSources.get(mediaElement);
  if (!routed) return;
  routed.source.disconnect();
  routed.gain.disconnect();
  routedSources.delete(mediaElement);
}

export async function unlockAudioBus(): Promise<void> {
  const current = getAudioBusGraph();
  await current.context.resume();
  if (sinkElement) await sinkElement.play();
}
