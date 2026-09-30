import { state } from '../core/state.svelte';
import { getNotificationVolumeMultiplier, getStoredMasterVolume } from '../core/settings';
import {
  createAudioOutputTransitionQueue,
  initializeAudioOutput,
  transitionAudioOutput
} from './audio-output-transition';

import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:audio-bus');

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

interface VoicePlayback {
  muted: boolean;
  volume: number;
}

export type VoicePlaybackPath = 'direct' | 'mixed' | 'none';

const routedSources = new WeakMap<HTMLMediaElement, RoutedSource>();
// Every remote voice element and the level its listener asked for; the path it
// takes (direct element playback or the Web Audio mix) is re-decided whenever
// the master volume, mute or output device changes.
const voiceElements = new Map<HTMLMediaElement, VoicePlayback>();
let graph: AudioBusGraph | null = null;
let sinkDestination: MediaStreamAudioDestinationNode | null = null;
let sinkElement: HTMLAudioElement | null = null;
const queueAudioOutputTransition = createAudioOutputTransitionQueue();

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

  graph = { context, limiter, master, media, sfx, voice };
  syncAudioBusSettings();
  const initialSinkId = state.outputDeviceId || '';
  void initializeAudioOutput(syncAudioBusOutput, initialSinkId);
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
  syncVoiceElements(options.muteDelayMs || 0);
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
    removeSinkElement();
    const contextWithSink = current.context as AudioContext & { setSinkId: (id: string) => Promise<void> };
    const selected = await transitionAudioOutput({
      disconnect: () => current.limiter.disconnect(),
      select: () => contextWithSink.setSinkId(sinkId),
      connect: () => current.limiter.connect(current.context.destination)
    });
    if (!selected) log.warn('audio context output device unavailable');
    return selected;
  }

  if (supportsElementSink()) {
    if (!sinkId) {
      connectDefaultOutput(current);
      return true;
    }
    sinkDestination ||= current.context.createMediaStreamDestination();
    sinkElement ||= document.createElement('audio');
    sinkElement.autoplay = true;
    (sinkElement as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
    const selected = await transitionAudioOutput({
      disconnect: () => current.limiter.disconnect(),
      select: () => sinkElement!.setSinkId(sinkId),
      connect: () => {
        sinkElement!.srcObject = sinkDestination!.stream;
        if (!sinkElement!.isConnected) document.body.append(sinkElement!);
        current.limiter.connect(sinkDestination!);
      }
    });
    if (!selected) {
      log.warn('audio element output device unavailable');
      removeSinkElement();
      return false;
    }

    try {
      await sinkElement.play();
    } catch (error) {
      log.warn('audio element playback requires a user gesture', errorContext(error));
      state.audioUnlockPending = true;
    }
    return true;
  }

  if (sinkId) {
    current.limiter.disconnect();
    removeSinkElement();
    return false;
  }
  connectDefaultOutput(current);
  return true;
}

export function syncAudioBusOutput(requestedId = state.outputDeviceId || ''): Promise<boolean> {
  const applyRequestedOutput = async () => {
    const selected = await applyAudioBusOutput(requestedId);
    for (const element of voiceElements.keys()) {
      if (!routedSources.has(element)) applyElementSink(element, requestedId);
    }
    return selected;
  };
  return queueAudioOutputTransition(applyRequestedOutput);
}

function outputGain(): number {
  if (state.outputMuted || state.localAppAudioSuppressed) return 0;
  return getStoredMasterVolume() / 100;
}

function applyElementSink(element: HTMLMediaElement, sinkId: string): void {
  if (!supportsElementSink()) return;
  const withSink = element as HTMLMediaElement & { sinkId?: string };
  if ((withSink.sinkId || '') === sinkId) return;
  element.setSinkId(sinkId).catch((error) => log.warn('voice element output device unavailable', errorContext(error)));
}

/**
 * Plays one remote voice. Chrome's echo canceller only takes audio that WebRTC
 * itself renders as its reference, so a voice mixed through Web Audio is
 * never subtracted from the listener's microphone and leaks back as echo for
 * anyone on speakers. Voices therefore play on their own element whenever the
 * requested level fits in [0, 1]; only a boost above 100% (per-user or master)
 * needs the Web Audio mix and its limiter.
 */
export function playVoiceElement(element: HTMLMediaElement, playback: VoicePlayback): VoicePlaybackPath {
  voiceElements.set(element, playback);
  return applyVoicePlayback(element, playback);
}

function applyVoicePlayback(element: HTMLMediaElement, playback: VoicePlayback): VoicePlaybackPath {
  const requested = Number.isFinite(playback.volume) ? Math.min(2, Math.max(0, playback.volume)) : 1;
  const level = playback.muted ? 0 : requested * outputGain();
  if (level > 1) {
    return routeMediaStreamElement(element, 'voice', { muted: playback.muted, volume: requested }) ? 'mixed' : 'none';
  }

  releaseRoutedSource(element);
  const stream = element.srcObject instanceof MediaStream ? element.srcObject : null;
  if (!stream?.getAudioTracks().some((track) => track.readyState !== 'ended')) {
    element.muted = true;
    return 'none';
  }
  element.volume = level;
  element.muted = level <= 0;
  applyElementSink(element, state.outputDeviceId || '');
  return 'direct';
}

function syncVoiceElements(muteDelayMs: number): void {
  const apply = () => {
    for (const [element, playback] of voiceElements) applyVoicePlayback(element, playback);
  };
  if (muteDelayMs > 0 && outputGain() === 0) window.setTimeout(apply, muteDelayMs);
  else apply();
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
    releaseRoutedSource(mediaElement);
    mediaElement.muted = true;
    return false;
  }

  const current = getAudioBusGraph();
  let routed = routedSources.get(mediaElement);
  if (!routed || routed.stream !== stream || routed.bus !== kind) {
    releaseRoutedSource(mediaElement);
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
  voiceElements.delete(mediaElement);
  releaseRoutedSource(mediaElement);
}

function releaseRoutedSource(mediaElement: HTMLMediaElement): void {
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
