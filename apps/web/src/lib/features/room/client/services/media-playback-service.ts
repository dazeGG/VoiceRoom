import { startUi } from '$lib/features/room/start-ui.svelte';
import { state } from '../core/state.svelte';
import { MAX_STREAM_VOLUME } from '../core/config';
import { getMicrophoneProcessors } from './microphone-service';
import { getParticipantAudioPreference, getParticipantAudioPreferenceKey } from '../core/settings';
import { musicPreferences } from '../core/music-preferences.svelte';
import type { Participant } from '../core/types';
import { setVoiceConnectionStatus } from '../ui/status';
import {
  getSharedAudioContext,
  releaseMediaStreamElement,
  routeMediaStreamElement,
  syncAudioBusOutput,
  syncAudioBusSettings,
  unlockAudioBus
} from './audio-bus';

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
  syncMusicAudioPlayback();
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
      const routed = routeMediaStreamElement(audio, 'voice', { muted, volume: preference.volume });
      if (routed && !muted && getSharedAudioContext().state !== 'running') {
        queueAudioUnlock({ showFallback: true });
      }
    } catch (error) {
      console.warn('Participant audio routing unavailable', error);
    }
    playMediaElement(audio);
  }
}

export function releaseRemoteAudioElement(mediaElement: HTMLMediaElement): void {
  releaseMediaStreamElement(mediaElement);
}

// --- Shared music lane ---------------------------------------------------
// The music bot is not a participant, so its audio element cannot hang off a
// `Participant` like every other remote track does. It lives here in module
// state instead, and there is at most one of it per client.
let musicAudioElement: HTMLAudioElement | null = null;
let musicTrackId = '';

export function getMusicAudioElement(): HTMLAudioElement | null {
  return musicAudioElement;
}

export function getMusicTrackId(): string {
  return musicTrackId;
}

export function attachMusicTrack(track: MediaStreamTrack): void {
  if (track.kind !== 'audio' || track.readyState === 'ended') return;

  if (musicAudioElement && musicTrackId === track.id) {
    if (!musicAudioElement.isConnected) document.body.append(musicAudioElement);
    syncMusicAudioPlayback();
    return;
  }

  detachMusicTrack();
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.muted = true;
  (audio as HTMLAudioElement & { playsInline: boolean }).playsInline = true;
  // The bot publishes on the ScreenShareAudio source, and a LiveKit stream can
  // carry more than one track, so the element gets exactly the music track.
  audio.srcObject = new MediaStream([track]);
  musicAudioElement = audio;
  musicTrackId = track.id;
  document.body.append(audio);
  syncMusicAudioPlayback();

  track.addEventListener('ended', () => detachMusicTrack(track.id), { once: true });
}

/** Tears the lane down. With a `trackId`, only when it is the attached track. */
export function detachMusicTrack(trackId = ''): void {
  const audio = musicAudioElement;
  if (!audio) return;
  if (trackId && musicTrackId !== trackId) return;

  audio.pause();
  audio.srcObject = null;
  releaseMediaStreamElement(audio);
  audio.remove();
  musicAudioElement = null;
  musicTrackId = '';
}

/**
 * Sibling of `applyRemoteParticipantAudioPreferences` for the music lane.
 *
 * Routes to the `'media'` bus — the one screen-share audio uses — and never to
 * `'voice'`: on the voice bus the voice master gain would also scale the music,
 * and per-listener music volume would stop being independent. The local
 * preference is applied as gain only; the subscription is never touched, so
 * muting costs nothing and survives a track change.
 */
export function syncMusicAudioPlayback(): void {
  const audio = musicAudioElement;
  if (!audio) return;

  const volume = musicPreferences.volume;
  const muted = isAppPlaybackMuted() || musicPreferences.muted || volume <= 0;
  try {
    const routed = routeMediaStreamElement(audio, 'media', { muted, volume });
    if (routed && !muted && getSharedAudioContext().state !== 'running') {
      queueAudioUnlock({ showFallback: true });
    }
  } catch (error) {
    console.warn('Music audio routing unavailable', error);
    audio.muted = true;
  }
  playMediaElement(audio);
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
  const volume = Number.isFinite(options.volume)
    ? Math.min(MAX_STREAM_VOLUME, Math.max(0, options.volume))
    : 1;
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
    console.warn('Stream audio routing unavailable', error);
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
  unlockAudio().catch((error) => console.warn('Audio unlock failed', error));
}

function shouldAttemptAudioUnlock(): boolean {
  return state.audioUnlockPending
    || state.voiceConnection === 'playback-blocked'
    || state.audioContext?.state === 'suspended';
}

export async function unlockAudio(): Promise<void> {
  await unlockAudioBus();
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
