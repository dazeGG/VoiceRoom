import { startUi } from '$lib/features/room/start-ui.svelte';
import { getScreenVideo, screenUi } from '$lib/features/room/screen-ui.svelte';
import { state } from '../core/state.svelte';
import { MAX_PARTICIPANT_VOLUME, MAX_STREAM_VOLUME } from '../core/config';
import { getMicrophoneProcessors } from './microphone-service';
import { getParticipantAudioPreference, getParticipantAudioPreferenceKey } from '../core/settings';
import type { Participant } from '../core/types';
import { setVoiceConnectionStatus } from '../ui/status';
import { syncScreenVideoAudio } from '../ui/screen-view';

export function supportsAudioOutputSelection(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

function supportsAudioContextOutputSelection(): boolean {
  return typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
}

export function getAvailableScreenMediaElementVolumeMax(): number {
  return state.outputDeviceId && supportsAudioOutputSelection() && !supportsAudioContextOutputSelection()
    ? 1
    : MAX_STREAM_VOLUME;
}

export function syncPlaybackMuteState(): void {
  syncRemoteAudioPlayback();
  syncScreenVideoAudio();
  if (isAppPlaybackMuted()) {
    state.audioUnlockPending = false;
    startUi.soundButtonVisible = false;
  }
}

export function syncRemoteAudioPlayback(): void {
  for (const peer of state.peers.values()) {
    applyRemoteParticipantAudioPreferences(peer);
  }
}

export function applyRemoteParticipantAudioPreferences(peer: Participant): void {
  const preferenceKey = getParticipantAudioPreferenceKey(peer.accountUserId, peer.id);
  const preference = getParticipantAudioPreference(preferenceKey);
  const muted = isVoicePlaybackMuted() || preference.muted || preference.volume <= 0;
  for (const audio of peer.audioElements.values()) {
    applyVoiceMediaElementVolume(audio, { muted, volume: preference.volume });
    applyAudioOutputDevice(audio).catch(() => {});
  }
}


interface VoiceAudioGain {
  gain: GainNode;
  source: MediaElementAudioSourceNode;
}

const voiceAudioGains = new WeakMap<HTMLMediaElement, VoiceAudioGain>();
let activeVoiceAudioGainCount = 0;

function hasActiveVoiceAudioGains(): boolean {
  return activeVoiceAudioGainCount > 0;
}

function rebuildActiveVoiceAudioElementsForOutputSwitch(): boolean {
  if (!hasActiveVoiceAudioGains()) return true;

  for (const peer of state.peers.values()) {
    for (const [trackId, audio] of peer.audioElements.entries()) {
      if (!voiceAudioGains.has(audio)) continue;

      const stream = audio.srcObject instanceof MediaStream ? audio.srcObject : null;
      const track = stream?.getAudioTracks().find((audioTrack) => audioTrack.id === trackId)
        ?? stream?.getAudioTracks()[0]
        ?? null;
      if (!stream || !track || track.readyState === 'ended') return false;

      const replacement = document.createElement('audio');
      replacement.autoplay = true;
      replacement.muted = true;
      (replacement as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
      replacement.srcObject = stream;
      document.body.append(replacement);

      releaseRemoteAudioElement(audio);
      audio.pause();
      audio.srcObject = null;
      audio.remove();
      peer.audioElements.set(trackId, replacement);

      track.addEventListener(
        'ended',
        () => {
          releaseRemoteAudioElement(replacement);
          replacement.remove();
          if (peer.audioElements.get(trackId) === replacement) peer.audioElements.delete(trackId);
        },
        { once: true }
      );
    }
  }

  return !hasActiveVoiceAudioGains();
}

export function releaseRemoteAudioElement(mediaElement: HTMLMediaElement): void {
  const existing = voiceAudioGains.get(mediaElement);
  if (!existing) return;
  existing.source.disconnect();
  existing.gain.disconnect();
  voiceAudioGains.delete(mediaElement);
  activeVoiceAudioGainCount = Math.max(0, activeVoiceAudioGainCount - 1);
}

function getAvailableVoiceMediaElementVolumeMax(): number {
  return state.outputDeviceId && supportsAudioOutputSelection() && !supportsAudioContextOutputSelection()
    ? 1
    : MAX_PARTICIPANT_VOLUME;
}

function applyVoiceMediaElementVolume(
  mediaElement: HTMLMediaElement,
  options: { muted: boolean; volume: number }
): boolean {
  const maxVolume = getAvailableVoiceMediaElementVolumeMax();
  const volume = Number.isFinite(options.volume) ? Math.min(maxVolume, Math.max(0, options.volume)) : 1;
  const existing = voiceAudioGains.get(mediaElement);

  if (existing) {
    // Once a media element is routed through createMediaElementSource(), browsers keep
    // that element's playback on the Web Audio graph for its lifetime. Keep the graph
    // alive and use gain=1 for normal volume instead of disconnecting it, because
    // disconnecting here can silence the element after a user lowers volume from >100%.
    mediaElement.volume = 1;
    mediaElement.muted = options.muted;
    existing.gain.gain.value = options.muted ? 0 : volume;
    playMediaElement(mediaElement);
    return true;
  }

  if (volume <= 1) {
    mediaElement.volume = Math.min(1, volume);
    mediaElement.muted = options.muted;
    playMediaElement(mediaElement);
    return true;
  }

  try {
    const context = getSharedAudioContext() as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
    if (state.outputDeviceId && typeof context.setSinkId === 'function') {
      context.setSinkId(state.outputDeviceId).catch((error) => {
        console.warn('Audio context output device unavailable', error);
      });
    }
    if (context.state !== 'running') {
      queueAudioUnlock({ showFallback: true });
      context.resume().catch(() => {});
    }

    const source = context.createMediaElementSource(mediaElement);
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    voiceAudioGains.set(mediaElement, { source, gain });
    activeVoiceAudioGainCount += 1;
    mediaElement.volume = 1;
    mediaElement.muted = options.muted;
    gain.gain.value = options.muted ? 0 : volume;
    playMediaElement(mediaElement);
    return true;
  } catch (error) {
    console.warn('Participant audio boost unavailable', error);
    mediaElement.volume = Math.min(1, volume);
    mediaElement.muted = options.muted;
    playMediaElement(mediaElement);
    return false;
  }
}

export async function syncAudioOutputDevices(): Promise<boolean> {
  if (!supportsAudioOutputSelection()) return false;
  if (state.outputDeviceId && screenAudioGainElement && !supportsAudioContextOutputSelection()) {
    console.warn('Audio output device unavailable while stream boost is active');
    return false;
  }
  if (state.outputDeviceId && !supportsAudioContextOutputSelection() && !rebuildActiveVoiceAudioElementsForOutputSwitch()) {
    console.warn('Audio output device unavailable while participant voice boost is active');
    return false;
  }

  syncRemoteAudioPlayback();

  const screenVideo = getScreenVideo();
  const mediaElements: HTMLMediaElement[] = screenVideo ? [screenVideo] : [];
  for (const peer of state.peers.values()) {
    mediaElements.push(...peer.audioElements.values());
  }

  const results = await Promise.all(mediaElements.map((mediaElement) => applyAudioOutputDevice(mediaElement)));
  const contextSynced = await applyAudioOutputDeviceToContext();
  syncScreenVideoAudio();
  return results.every(Boolean) && contextSynced !== false;
}

export async function applyAudioOutputDevice(mediaElement: HTMLMediaElement): Promise<boolean> {
  if (!supportsAudioOutputSelection()) return false;

  const sinkId = state.outputDeviceId || '';
  if (mediaElement.sinkId === sinkId) return true;

  try {
    await mediaElement.setSinkId(sinkId);
    return true;
  } catch (error) {
    console.warn('Audio output device unavailable', error);
    return false;
  }
}

async function applyAudioOutputDeviceToContext(): Promise<boolean> {
  const context = state.audioContext as (AudioContext & { setSinkId?: (sinkId: string) => Promise<void> }) | null;
  if (!context || typeof context.setSinkId !== 'function') return true;

  try {
    await context.setSinkId(state.outputDeviceId || '');
    return true;
  } catch (error) {
    console.warn('Audio context output device unavailable', error);
    return false;
  }
}

export function getSharedAudioContext(): AudioContext {
  state.audioContext ||= new AudioContext();
  applyAudioOutputDeviceToContext().catch(() => {});
  return state.audioContext;
}

let screenAudioSource: MediaElementAudioSourceNode | null = null;
let screenAudioGain: GainNode | null = null;
let screenAudioGainElement: HTMLMediaElement | null = null;

export function applyScreenMediaElementVolume(
  mediaElement: HTMLMediaElement,
  options: { boostAllowed: boolean; muted: boolean; volume: number }
): boolean {
  const volume = Number.isFinite(options.volume)
    ? Math.min(getAvailableScreenMediaElementVolumeMax(), Math.max(0, options.volume))
    : 1;
  if (volume <= 1 || !options.boostAllowed) {
    mediaElement.volume = screenAudioGainElement === mediaElement ? 1 : Math.min(1, volume);
    mediaElement.muted = options.muted;
    if (screenAudioGainElement === mediaElement && screenAudioGain) {
      screenAudioGain.gain.value = options.muted ? 0 : Math.min(1, volume);
    }
    return true;
  }

  try {
    const context = getSharedAudioContext() as AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
    if (state.outputDeviceId && typeof context.setSinkId === 'function') {
      context.setSinkId(state.outputDeviceId).catch((error) => {
        console.warn('Audio context output device unavailable', error);
      });
    }
    if (context.state !== 'running') {
      queueAudioUnlock({ showFallback: true });
      context.resume().catch(() => {});
    }

    if (screenAudioGainElement !== mediaElement) {
      screenAudioSource?.disconnect();
      screenAudioGain?.disconnect();
      screenAudioSource = context.createMediaElementSource(mediaElement);
      screenAudioGain = context.createGain();
      screenAudioSource.connect(screenAudioGain);
      screenAudioGain.connect(context.destination);
      screenAudioGainElement = mediaElement;
    }
    mediaElement.volume = 1;
    mediaElement.muted = options.muted;
    screenAudioGain!.gain.value = options.muted ? 0 : volume;
    return true;
  } catch (error) {
    console.warn('Stream audio boost unavailable', error);
    mediaElement.volume = Math.min(1, volume);
    mediaElement.muted = options.muted;
    return false;
  }
}

export function isVoicePlaybackMuted(): boolean {
  return state.outputMuted || isLocalAppAudioSuppressed();
}

export function isAppPlaybackMuted(): boolean {
  return state.outputMuted || isLocalAppAudioSuppressed();
}

export function isLocalAppAudioSuppressed(): boolean {
  return state.localAppAudioSuppressed;
}

export function setLocalAppAudioSuppressed(suppressed: boolean): void {
  state.localAppAudioSuppressed = Boolean(suppressed);
  syncLocalAppAudioSuppression();
}

function syncLocalAppAudioSuppression(): void {
  syncPlaybackMuteState();
}

export function queueAudioUnlock(options: { showFallback?: boolean } = {}): void {
  if (isAppPlaybackMuted()) return;

  state.audioUnlockPending = true;
  if (options.showFallback) startUi.soundButtonVisible = true;
}

export function handleAudioUnlockGesture(): void {
  if (!shouldAttemptAudioUnlock()) return;

  unlockAudio().catch((error) => console.warn('Audio unlock failed', error));
}

function shouldAttemptAudioUnlock(): boolean {
  return state.audioUnlockPending
    || state.voiceConnection === 'playback-blocked'
    || state.audioContext?.state === 'suspended';
}

export async function unlockAudio(): Promise<void> {
  await state.audioContext?.resume();
  await Promise.allSettled(getMicrophoneProcessors(state.micProcessor).map((processor) => processor.context?.resume()));
  const plays: Promise<void>[] = [];
  for (const peer of state.peers.values()) {
    for (const audio of peer.audioElements.values()) plays.push(audio.play());
  }
  const screenVideo = getScreenVideo();
  if (screenUi.stageVisible && screenVideo) plays.push(screenVideo.play());
  await Promise.allSettled(plays);
  state.audioUnlockPending = false;
  startUi.soundButtonVisible = false;
  if (state.voiceConnection === 'playback-blocked') setVoiceConnectionStatus('connected');
}

export function playMediaElement(element: HTMLMediaElement): void {
  element.play().catch(() => {
    if (!element.muted) queueAudioUnlock({ showFallback: true });
  });
}
