import { NOTIFICATION_VOLUME_BOOST, PEER_JOIN_CUE_DEDUPE_MS, STREAM_VIEWER_CUE_DEDUPE_MS } from '../core/config';
import { getInstalledCallPorts } from '../ports';
import { state } from '../core/room-runtime.store';
import {
  getSharedAudioContext,
  isAppPlaybackMuted,
  isLocalAppAudioSuppressed,
  queueAudioUnlock
} from '../services/media-playback-service';
import { getAudioBusInput } from '../services/audio-bus';

import { createLogger, errorContext } from '../diagnostics';

const log = createLogger('room:cues');

const peerJoinCueTimes = new Map<string, number>();
const streamViewerCueTimes = new Map<string, number>();

function isCuePlaybackSuppressed(): boolean {
  return getInstalledCallPorts()?.host.suppressCuePlayback() || isAppPlaybackMuted();
}

function getCueGain(value: number): number {
  return value * NOTIFICATION_VOLUME_BOOST;
}

interface CueNote {
  frequency: number;
  peak: number;
  start?: number;
  duration?: number;
  type?: OscillatorType;
}

function playCueSequence(notes: CueNote[], label: string, stopSignal?: AbortSignal): void {
  if (isCuePlaybackSuppressed()) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      if (!stopSignal) queueAudioUnlock();
      return;
    }

    const now = context.currentTime;
    notes.forEach((note, index) => {
      const startedAt = now + (note.start ?? index * 0.095);
      const duration = note.duration ?? 0.12;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = note.type || 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, startedAt);
      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(getCueGain(note.peak), startedAt + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + duration);

      oscillator.connect(gain);
      gain.connect(getAudioBusInput('sfx'));
      oscillator.start(startedAt);
      oscillator.stop(startedAt + duration + 0.02);
      const stop = () => {
        gain.disconnect();
        oscillator.stop();
      };
      stopSignal?.addEventListener('abort', stop, { once: true });
      oscillator.addEventListener('ended', () => {
        stopSignal?.removeEventListener('abort', stop);
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    if (!stopSignal) log.warn(`${label} sound unavailable`, errorContext(error));
  }
}

export function playDirectMessageCue(): void {
  playCueSequence(
    [
      { frequency: 660, peak: 0.03, duration: 0.105 },
      { frequency: 880, peak: 0.026, start: 0.075, duration: 0.12 }
    ],
    'DM'
  );
}

const ROOM_CHAT_CUE_DEDUPE_MS = 10_000;
const roomChatCueTimes = new Map<string, number>();

// The same room message can reach several listeners at once — the lobby preview
// and the open room each mount a chat panel, and a mention also rings from the
// lobby — so a message id is heard only once.
export function playRoomChatMessageCue(messageId?: string): void {
  if (messageId) {
    const now = Date.now();
    for (const [id, playedAt] of roomChatCueTimes) {
      if (now - playedAt > ROOM_CHAT_CUE_DEDUPE_MS) roomChatCueTimes.delete(id);
    }
    if (roomChatCueTimes.has(messageId)) return;
    roomChatCueTimes.set(messageId, now);
  }
  playCueSequence(
    [
      { frequency: 587, peak: 0.026, duration: 0.095 },
      { frequency: 784, peak: 0.024, start: 0.065, duration: 0.11 }
    ],
    'Room chat'
  );
}

export function playFriendRequestCue(): void {
  playCueSequence(
    [
      { frequency: 523, peak: 0.028, duration: 0.11 },
      { frequency: 659, peak: 0.03, start: 0.085, duration: 0.11 },
      { frequency: 784, peak: 0.024, start: 0.17, duration: 0.13 }
    ],
    'Friend request'
  );
}

export function playFriendAcceptedCue(): void {
  playCueSequence(
    [
      { frequency: 587, peak: 0.028, duration: 0.1 },
      { frequency: 740, peak: 0.03, start: 0.08, duration: 0.11 },
      { frequency: 988, peak: 0.022, start: 0.17, duration: 0.16 }
    ],
    'Friend accepted'
  );
}

export function playRingCue(stopSignal?: AbortSignal): void {
  if (stopSignal?.aborted) return;
  playCueSequence(
    [
      { frequency: 659, peak: 0.032, duration: 0.14 },
      { frequency: 880, peak: 0.034, start: 0.13, duration: 0.16 },
      { frequency: 659, peak: 0.03, start: 0.34, duration: 0.14 },
      { frequency: 988, peak: 0.032, start: 0.47, duration: 0.2 }
    ],
    'Ring',
    stopSignal
  );
}

export function startCallRinger(signal: AbortSignal): void {
  if (signal.aborted) return;
  playRingCue(signal);
  const interval = setInterval(() => playRingCue(signal), 3_000);
  signal.addEventListener('abort', () => clearInterval(interval), { once: true });
}

export async function waitForCallRingerAudio(signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  try {
    const context = getSharedAudioContext();
    if (context.state === 'running') return true;
    if (context.state === 'closed') return false;

    return await new Promise((resolve) => {
      const listeners = new AbortController();
      const onAbort = () => finish(false);
      const onGesture = () => void context.resume().catch(() => {});
      function finish(playable: boolean): void {
        listeners.abort();
        signal.removeEventListener('abort', onAbort);
        resolve(playable);
      }
      signal.addEventListener('abort', onAbort, { once: true });
      context.addEventListener(
        'statechange',
        () => {
          if (context.state === 'running') finish(true);
          else if (context.state === 'closed') finish(false);
        },
        { signal: listeners.signal }
      );
      document.addEventListener('pointerdown', onGesture, { signal: listeners.signal });
      document.addEventListener('keydown', onGesture, { signal: listeners.signal });
    });
  } catch {
    return false;
  }
}

export function playPeerJoinCue(peerId: string | undefined): void {
  if (!peerId || peerId === state.peerId || isCuePlaybackSuppressed()) return;

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

export function clearStreamViewerCues(): void {
  streamViewerCueTimes.clear();
}

function shouldPlayStreamViewerCue(type: 'join' | 'leave'): boolean {
  if (isCuePlaybackSuppressed()) return false;
  const now = Date.now();
  const lastPlayedAt = streamViewerCueTimes.get(type) || 0;
  if (now - lastPlayedAt < STREAM_VIEWER_CUE_DEDUPE_MS) return false;

  streamViewerCueTimes.set(type, now);
  return true;
}

export function playPeerCue(type: 'join' | 'leave'): void {
  if (isCuePlaybackSuppressed()) return;

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
      gain.connect(getAudioBusInput('sfx'));
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.13);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    log.warn('peer sound unavailable', errorContext(error));
  }
}

export function playMicCue(muted: boolean): void {
  if (isCuePlaybackSuppressed()) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      queueAudioUnlock();
      return;
    }

    const now = context.currentTime;
    const notes = muted
      ? [
          { frequency: 587, peak: 0.042 },
          { frequency: 440, peak: 0.034 }
        ]
      : [
          { frequency: 440, peak: 0.04 },
          { frequency: 659, peak: 0.048 }
        ];

    notes.forEach((note, index) => {
      const startedAt = now + index * 0.1;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, startedAt);

      gain.gain.setValueAtTime(0.0001, startedAt);
      gain.gain.exponentialRampToValueAtTime(getCueGain(note.peak), startedAt + 0.016);
      gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.1);

      oscillator.connect(gain);
      gain.connect(getAudioBusInput('sfx'));
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.12);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    log.warn('mic sound unavailable', errorContext(error));
  }
}

export function playOutputCue(muted: boolean): void {
  if (getInstalledCallPorts()?.host.suppressCuePlayback() || isLocalAppAudioSuppressed()) return;

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
      gain.connect(getAudioBusInput('sfx'));
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.12);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    log.warn('output sound unavailable', errorContext(error));
  }
}

export function playStreamCue(type: 'start' | 'stop'): void {
  if (isCuePlaybackSuppressed()) return;

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
      gain.connect(getAudioBusInput('sfx'));
      oscillator.start(startedAt);
      oscillator.stop(startedAt + 0.105);
      oscillator.addEventListener('ended', () => {
        oscillator.disconnect();
        gain.disconnect();
      });
    });
  } catch (error) {
    log.warn('stream sound unavailable', errorContext(error));
  }
}

export function playStreamViewerCue(type: 'join' | 'leave'): void {
  if (isCuePlaybackSuppressed()) return;
  if (!shouldPlayStreamViewerCue(type)) return;

  try {
    const context = getSharedAudioContext();
    if (context.state !== 'running') {
      queueAudioUnlock();
      return;
    }

    const now = context.currentTime;

    if (type === 'join') {
      const notes = [
        { frequency: 440, peak: 0.024 },
        { frequency: 523, peak: 0.02 }
      ];

      notes.forEach((note, index) => {
        const startedAt = now + index * 0.12;
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(note.frequency, startedAt);

        gain.gain.setValueAtTime(0.0001, startedAt);
        gain.gain.exponentialRampToValueAtTime(getCueGain(note.peak), startedAt + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + 0.11);

        oscillator.connect(gain);
        gain.connect(getAudioBusInput('sfx'));
        oscillator.start(startedAt);
        oscillator.stop(startedAt + 0.13);
        oscillator.addEventListener('ended', () => {
          oscillator.disconnect();
          gain.disconnect();
        });
      });
      return;
    }

    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(523, now);
    oscillator.frequency.exponentialRampToValueAtTime(440, now + 0.16);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(getCueGain(0.018), now + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    oscillator.connect(gain);
    gain.connect(getAudioBusInput('sfx'));
    oscillator.start(now);
    oscillator.stop(now + 0.18);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      gain.disconnect();
    });
  } catch (error) {
    log.warn('stream viewer sound unavailable', errorContext(error));
  }
}
