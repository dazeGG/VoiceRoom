import { NOTIFICATION_VOLUME_BOOST, PEER_JOIN_CUE_DEDUPE_MS } from '../core/config';
import { state } from '../core/state';
import { getSharedAudioContext, isAppPlaybackMuted, isLocalAppAudioSuppressed, queueAudioUnlock } from './playback';

const peerJoinCueTimes = new Map<string, number>();

function getCueGain(value: number): number {
  return value * NOTIFICATION_VOLUME_BOOST;
}

export function playPeerJoinCue(peerId: string | undefined): void {
  if (!peerId || peerId === state.peerId) return;

  const now = Date.now();
  const lastPlayedAt = peerJoinCueTimes.get(peerId) || 0;
  if (now - lastPlayedAt < PEER_JOIN_CUE_DEDUPE_MS) return;

  peerJoinCueTimes.set(peerId, now);
  playPeerCue('join');
}

export function clearPeerJoinCue(peerId: string | undefined): void {
  if (peerId) peerJoinCueTimes.delete(peerId);
}

export function clearAllPeerJoinCues(): void {
  peerJoinCueTimes.clear();
}

export function playPeerCue(type: 'join' | 'leave'): void {
  if (isAppPlaybackMuted()) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      queueAudioUnlock();
      return;
    }

    const isJoin = type === 'join';
    const now = context.currentTime;
    const notes = isJoin ? [520, 760] : [390, 240];

    notes.forEach((frequency, index) => {
      const startedAt = now + index * 0.13;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startedAt);

      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(getCueGain(isJoin ? 0.052 : 0.044), startedAt + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.11);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.13);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    console.warn('Peer sound unavailable', error);
  }
}

export function playMicCue(muted: boolean): void {
  if (isAppPlaybackMuted()) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      queueAudioUnlock();
      return;
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(muted ? 460 : 260, now);
    oscillator.frequency.exponentialRampToValueAtTime(muted ? 190 : 620, now + 0.2);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(getCueGain(0.038), now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.26);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      gain.disconnect();
    });
  } catch (error) {
    console.warn('Mic sound unavailable', error);
  }
}

export function playOutputCue(muted: boolean): void {
  if (isLocalAppAudioSuppressed()) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      queueAudioUnlock();
      return;
    }

    const now = context.currentTime;
    const frequencies = muted ? [660, 360] : [360, 660];

    frequencies.forEach((frequency, index) => {
      const startedAt = now + index * 0.085;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startedAt);

      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(getCueGain(0.034), startedAt + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.11);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.12);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    console.warn('Output sound unavailable', error);
  }
}

export function playStreamCue(type: 'start' | 'stop'): void {
  if (isAppPlaybackMuted()) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      queueAudioUnlock();
      return;
    }

    const isStart = type === 'start';
    const now = context.currentTime;
    const notes = isStart ? [880, 1175, 1568] : [1568, 1109, 740];

    notes.forEach((frequency, index) => {
      const startedAt = now + index * 0.105;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, startedAt);

      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(getCueGain(0.038), startedAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.09);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.105);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    console.warn('Stream sound unavailable', error);
  }
}
