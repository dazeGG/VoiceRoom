import { startUi } from '$lib/features/room/start-ui.svelte';
import { state } from '../core/state.svelte';
import { MAX_STREAM_VOLUME } from '../core/config';
import { getMicrophoneProcessors } from './microphone-service';
import { getParticipantAudioPreference, getParticipantAudioPreferenceKey } from '../core/settings';
import type { Participant } from '../core/types';
import { setVoiceConnectionStatus } from '../ui/status';
import {
  getSharedAudioContext,
  playVoiceElement,
  releaseMediaStreamElement,
  routeMediaStreamElement,
  syncAudioBusOutput,
  syncAudioBusSettings,
  unlockAudioBus
} from './audio-bus';

import { createLogger, errorContext } from '$lib/shared/log';

const log = createLogger('room:playback');

export { getSharedAudioContext } from './audio-bus';

function syncScreenVideoAudioSoon(): void {
  void import('../ui/screen-view').then((module) => module.syncScreenVideoAudio());
}

export function supportsAudioOutputSelection(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

export function syncPlaybackMuteState(options: { muteDelayMs?: number } = {}): void {
  syncAudioBusSettings(options);
  syncRemoteAudioPlayback();
  syncScreenVideoAudioSoon();
  if (isAppPlaybackMuted()) {
    state.audioUnlockPending = false;
    startUi.soundButtonVisible = false;
  }
}

export function syncRemoteAudioPlayback(): void {
  for (const peer of state.peers.values()) applyRemoteParticipantAudioPreferences(peer);
}

export function applyRemoteParticipantAudioPreferences(peer: Participant): void {
  const preferenceKey = getParticipantAudioPreferenceKey(peer.accountUserId, peer.id);
  const preference = getParticipantAudioPreference(preferenceKey);
  const muted = isAppPlaybackMuted() || preference.muted || preference.volume <= 0;
  for (const audio of peer.audioElements.values()) {
    try {
      const path = playVoiceElement(audio, { muted, volume: preference.volume });
      if (path === 'mixed' && !muted && getSharedAudioContext().state !== 'running') {
        queueAudioUnlock({ showFallback: true });
      }
    } catch (error) {
      log.warn('participant audio routing unavailable', errorContext(error));
    }
    playMediaElement(audio);
  }
}

export function releaseRemoteAudioElement(mediaElement: HTMLMediaElement): void {
  releaseMediaStreamElement(mediaElement);
}

export async function syncAudioOutputDevices(): Promise<boolean> {
  const synced = await syncAudioBusOutput();
  syncScreenVideoAudioSoon();
  return synced;
}

export function applyScreenMediaElementVolume(
  mediaElement: HTMLMediaElement,
  options: { boostAllowed: boolean; muted: boolean; volume: number }
): boolean {
  const volume = Number.isFinite(options.volume) ? Math.min(MAX_STREAM_VOLUME, Math.max(0, options.volume)) : 1;
  if (!options.boostAllowed) {
    releaseMediaStreamElement(mediaElement);
    mediaElement.volume = 1;
    mediaElement.muted = true;
    return true;
  }

  try {
    const routed = routeMediaStreamElement(mediaElement, 'media', {
      muted: options.muted,
      volume
    });
    if (routed && !options.muted && getSharedAudioContext().state !== 'running') {
      queueAudioUnlock({ showFallback: true });
    }
    if (routed) playMediaElement(mediaElement);
    return routed;
  } catch (error) {
    log.warn('stream audio routing unavailable', errorContext(error));
    mediaElement.muted = true;
    return false;
  }
}

export function releaseScreenMediaElement(mediaElement: HTMLMediaElement): void {
  releaseMediaStreamElement(mediaElement);
}

export function isAppPlaybackMuted(): boolean {
  return state.outputMuted || isLocalAppAudioSuppressed();
}

export function isLocalAppAudioSuppressed(): boolean {
  return state.localAppAudioSuppressed;
}

export function setLocalAppAudioSuppressed(suppressed: boolean): void {
  state.localAppAudioSuppressed = Boolean(suppressed);
  syncPlaybackMuteState();
}

export function queueAudioUnlock(options: { showFallback?: boolean } = {}): void {
  if (isAppPlaybackMuted()) return;
  state.audioUnlockPending = true;
  if (options.showFallback && !hasPendingStreamWatchGate()) startUi.soundButtonVisible = true;
}

function hasPendingStreamWatchGate(): boolean {
  for (const peer of state.peers.values()) {
    if (peer.isLocal || !peer.screen) continue;
    if (state.viewedScreenPeerId === peer.id || state.screenSubscribedPeerIds.has(peer.id)) continue;
    return true;
  }
  return false;
}

export function handleAudioUnlockGesture(): void {
  if (!shouldAttemptAudioUnlock()) return;
  unlockAudio().catch((error) => log.warn('audio unlock failed', errorContext(error)));
}

function shouldAttemptAudioUnlock(): boolean {
  return (
    state.audioUnlockPending ||
    state.voiceConnection === 'playback-blocked' ||
    state.audioContext?.state === 'suspended'
  );
}

export async function unlockAudio(): Promise<void> {
  await unlockAudioBus();
  // Voices on the direct path are unmuted media elements: a play() the
  // browser refused before this gesture has to be retried now.
  syncRemoteAudioPlayback();
  await Promise.allSettled(getMicrophoneProcessors(state.micProcessor).map((processor) => processor.context?.resume()));
  state.audioUnlockPending = false;
  startUi.soundButtonVisible = false;
  if (state.voiceConnection === 'playback-blocked') setVoiceConnectionStatus('connected');
}

export function playMediaElement(element: HTMLMediaElement): void {
  element.play().catch(() => {
    if (!element.muted) queueAudioUnlock({ showFallback: true });
  });
}
