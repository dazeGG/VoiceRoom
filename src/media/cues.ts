import {
  NOTIFICATION_VOLUME_BOOST,
  PEER_JOIN_CUE_DEDUPE_MS,
  STREAM_VIEWER_CUE_DEDUPE_MS
} from '../core/config';
import { state } from '../core/state';
import { getSharedAudioContext, isAppPlaybackMuted, isLocalAppAudioSuppressed, queueAudioUnlock } from './playback';

const peerJoinCueTimes = new Map<string, number>();
const streamViewerCueTimes = new Map<string, number>();

type ToneSpec = {
  attack: number;
  decay: number;
  endFreq?: number;
  freq: number;
  peak: number;
  start: number;
  type?: OscillatorType;
};

function getCueGain(value: number): number {
  return value * NOTIFICATION_VOLUME_BOOST;
}

async function ensureCueContext(): Promise<AudioContext | null> {
  try {
    const context = getSharedAudioContext();
    if (context.state === 'suspended') {
      await context.resume();
    }
    if (context.state !== 'running') {
      queueAudioUnlock();
      return null;
    }
    return context;
  } catch (error) {
    console.warn('Cue audio context unavailable', error);
    return null;
  }
}

function scheduleTone(context: AudioContext, tone: ToneSpec): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + tone.start;
  const endAt = start + tone.attack + tone.decay;

  oscillator.type = tone.type ?? 'sine';
  oscillator.frequency.setValueAtTime(Math.max(tone.freq, 1), start);
  if (tone.endFreq) {
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(tone.endFreq, 1), endAt);
  }

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(getCueGain(tone.peak), start + tone.attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(endAt + 0.02);
  oscillator.addEventListener('ended', () => {
    oscillator.disconnect();
    gain.disconnect();
  });
}

async function playTonePattern(tones: ToneSpec[]): Promise<void> {
  const context = await ensureCueContext();
  if (!context) return;

  for (const tone of tones) {
    scheduleTone(context, tone);
  }
}

function shouldPlayStreamViewerCue(type: 'join' | 'leave'): boolean {
  const now = Date.now();
  const dedupeKey = type;
  const lastPlayedAt = streamViewerCueTimes.get(dedupeKey) || 0;
  if (now - lastPlayedAt < STREAM_VIEWER_CUE_DEDUPE_MS) return false;

  streamViewerCueTimes.set(dedupeKey, now);
  return true;
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

export function clearStreamViewerCues(): void {
  streamViewerCueTimes.clear();
}

export function playPeerCue(type: 'join' | 'leave'): void {
  if (isAppPlaybackMuted()) return;

  if (type === 'join') {
    void playTonePattern([
      { type: 'sine', freq: 294, start: 0, attack: 0.02, decay: 0.15, peak: 0.052 },
      { type: 'sine', freq: 370, start: 0.16, attack: 0.02, decay: 0.17, peak: 0.048 }
    ]);
    return;
  }

  void playTonePattern([
    { type: 'sine', freq: 415, start: 0, attack: 0.014, decay: 0.1, peak: 0.044 },
    { type: 'sine', freq: 311, start: 0.11, attack: 0.014, decay: 0.13, peak: 0.04 }
  ]);
}

export function playMicCue(muted: boolean): void {
  if (isAppPlaybackMuted()) return;

  if (muted) {
    void playTonePattern([
      { type: 'triangle', freq: 520, endFreq: 210, start: 0, attack: 0.014, decay: 0.18, peak: 0.048 }
    ]);
    return;
  }

  void playTonePattern([
    { type: 'triangle', freq: 230, endFreq: 620, start: 0, attack: 0.016, decay: 0.2, peak: 0.05 }
  ]);
}

export function playOutputCue(muted: boolean): void {
  if (isLocalAppAudioSuppressed()) return;

  if (muted) {
    void playTonePattern([
      { type: 'sine', freq: 587, start: 0, attack: 0.012, decay: 0.09, peak: 0.038 },
      { type: 'sine', freq: 392, start: 0.085, attack: 0.012, decay: 0.11, peak: 0.034 }
    ]);
    return;
  }

  void playTonePattern([
    { type: 'sine', freq: 392, start: 0, attack: 0.012, decay: 0.09, peak: 0.042 },
    { type: 'sine', freq: 523, start: 0.085, attack: 0.012, decay: 0.12, peak: 0.04 }
  ]);
}

export function playStreamCue(type: 'start' | 'stop'): void {
  if (isAppPlaybackMuted()) return;

  if (type === 'start') {
    void playTonePattern([
      { type: 'triangle', freq: 784, start: 0, attack: 0.014, decay: 0.1, peak: 0.048 },
      { type: 'triangle', freq: 988, start: 0.09, attack: 0.014, decay: 0.1, peak: 0.046 },
      { type: 'sine', freq: 1175, start: 0.18, attack: 0.014, decay: 0.12, peak: 0.044 }
    ]);
    return;
  }

  void playTonePattern([
    { type: 'sine', freq: 1175, start: 0, attack: 0.012, decay: 0.08, peak: 0.042 },
    { type: 'sine', freq: 880, start: 0.08, attack: 0.012, decay: 0.08, peak: 0.04 },
    { type: 'triangle', freq: 659, start: 0.16, attack: 0.012, decay: 0.14, peak: 0.038 }
  ]);
}

export function playStreamViewerCue(type: 'join' | 'leave'): void {
  if (isAppPlaybackMuted()) return;
  if (!shouldPlayStreamViewerCue(type)) return;

  if (type === 'join') {
    void playTonePattern([
      { type: 'sine', freq: 740, start: 0, attack: 0.01, decay: 0.07, peak: 0.032 },
      { type: 'triangle', freq: 988, start: 0.055, attack: 0.01, decay: 0.09, peak: 0.028 }
    ]);
    return;
  }

  void playTonePattern([
    { type: 'sine', freq: 659, endFreq: 494, start: 0, attack: 0.01, decay: 0.12, peak: 0.026 }
  ]);
}