import {
  NOTIFICATION_VOLUME_BOOST,
  PEER_JOIN_CUE_DEDUPE_MS,
  STREAM_VIEWER_CUE_DEDUPE_MS
} from '../core/config';
import { state } from '../core/state';
import { getSharedAudioContext, isAppPlaybackMuted, isLocalAppAudioSuppressed, queueAudioUnlock } from './playback';

const peerJoinCueTimes = new Map<string, number>();
const streamViewerCueTimes = new Map<string, number>();

const NOTE_GAP = 0.12;

/** Soft attack/decay envelope for understated UI tones. */
const ATTACK = 0.028;
const DECAY_PAIR = 0.2;
const DECAY_GLIDE = 0.22;
const DECAY_SUBTLE = 0.16;

/**
 * A minor pentatonic — open, neutral palette without major cheer or minor drama.
 * Intervals lean on fourths/fifths for a premium, minimal feel.
 */
const PM = {
  A3: 220,
  C4: 262,
  D4: 294,
  E4: 330,
  G4: 392,
  A4: 440,
  C5: 523,
  D5: 587
} as const;

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

function pairedNotes(
  first: number,
  second: number,
  options: { peak?: number; secondPeak?: number } = {}
): ToneSpec[] {
  const { peak = 0.038, secondPeak = 0.034 } = options;

  return [
    { type: 'sine', freq: first, start: 0, attack: ATTACK, decay: DECAY_PAIR, peak },
    { type: 'sine', freq: second, start: NOTE_GAP, attack: ATTACK, decay: DECAY_PAIR, peak: secondPeak }
  ];
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
    void playTonePattern(pairedNotes(PM.G4, PM.C5));
    return;
  }

  void playTonePattern(pairedNotes(PM.C5, PM.G4, { secondPeak: 0.03 }));
}

export function playMicCue(muted: boolean): void {
  if (isAppPlaybackMuted()) return;

  if (muted) {
    void playTonePattern([
      { type: 'sine', freq: PM.G4, endFreq: PM.E4, start: 0, attack: ATTACK, decay: DECAY_GLIDE, peak: 0.034 }
    ]);
    return;
  }

  void playTonePattern([
    { type: 'sine', freq: PM.E4, endFreq: PM.G4, start: 0, attack: ATTACK, decay: DECAY_GLIDE, peak: 0.036 }
  ]);
}

export function playOutputCue(muted: boolean): void {
  if (isLocalAppAudioSuppressed()) return;

  if (muted) {
    void playTonePattern(pairedNotes(PM.A4, PM.E4, { peak: 0.032, secondPeak: 0.028 }));
    return;
  }

  void playTonePattern(pairedNotes(PM.E4, PM.A4, { peak: 0.034, secondPeak: 0.03 }));
}

export function playStreamCue(type: 'start' | 'stop'): void {
  if (isAppPlaybackMuted()) return;

  if (type === 'start') {
    void playTonePattern(pairedNotes(PM.G4, PM.D5, { peak: 0.036, secondPeak: 0.032 }));
    return;
  }

  void playTonePattern(pairedNotes(PM.D5, PM.G4, { peak: 0.032, secondPeak: 0.028 }));
}

export function playStreamViewerCue(type: 'join' | 'leave'): void {
  if (isAppPlaybackMuted()) return;
  if (!shouldPlayStreamViewerCue(type)) return;

  if (type === 'join') {
    void playTonePattern(pairedNotes(PM.A4, PM.C5, { peak: 0.024, secondPeak: 0.02 }));
    return;
  }

  void playTonePattern([
    { type: 'sine', freq: PM.C5, endFreq: PM.A4, start: 0, attack: 0.02, decay: DECAY_SUBTLE, peak: 0.018 }
  ]);
}