
import { elements } from '../ui/dom';
import { state } from '../core/state';
import { getMicrophoneProcessors } from './microphone-service';
import { setVoiceConnectionStatus } from '../ui/status';
import { syncScreenVideoAudio } from '../ui/screen-view';

export function supportsAudioOutputSelection(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export function syncPlaybackMuteState(): void {
  syncRemoteAudioPlayback();
  syncScreenVideoAudio();
  if (isAppPlaybackMuted()) {
    state.audioUnlockPending = false;
    elements.soundButton.hidden = true;
  }
}

export function syncRemoteAudioPlayback(): void {
  const muted = isVoicePlaybackMuted();
  for (const peer of state.peers.values()) {
    for (const audio of peer.audioElements.values()) {
      audio.muted = muted;
      applyAudioOutputDevice(audio).catch(() => {});
    }
  }
}

export async function syncAudioOutputDevices(): Promise<boolean> {
  if (!supportsAudioOutputSelection()) return false;

  const mediaElements: HTMLMediaElement[] = [elements.screenVideo];
  for (const peer of state.peers.values()) {
    mediaElements.push(...peer.audioElements.values());
  }

  const results = await Promise.all(mediaElements.map((mediaElement) => applyAudioOutputDevice(mediaElement)));
  const contextSynced = await applyAudioOutputDeviceToContext();
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
  if (options.showFallback) elements.soundButton.hidden = false;
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
  if (!elements.screenStage.hidden) plays.push(elements.screenVideo.play());
  await Promise.allSettled(plays);
  state.audioUnlockPending = false;
  elements.soundButton.hidden = true;
  if (state.voiceConnection === 'playback-blocked') setVoiceConnectionStatus('connected');
}

export function playMediaElement(element: HTMLMediaElement): void {
  element.play().catch(() => {
    if (!element.muted) queueAudioUnlock({ showFallback: true });
  });
}

