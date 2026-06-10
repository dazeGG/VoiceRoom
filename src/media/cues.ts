import {
  NOTIFICATION_VOLUME_BOOST,
  PEER_JOIN_CUE_DEDUPE_MS,
  STREAM_VIEWER_CUE_DEDUPE_MS
} from '../core/config';
import { state } from '../core/state';
import { getSharedAudioContext, isAppPlaybackMuted, isLocalAppAudioSuppressed, queueAudioUnlock } from './playback';

const peerJoinCueTimes = new Map<string, number>();
const streamViewerCueTimes = new Map<string, number>();

/** Spacing between paired/arpeggiated cue notes. */
const NOTE_GAP = 0.12;

/**
 * B natural minor — shared palette inspired by Tchaikovsky (Swan Lake oboe register).
 * All UI cues stay inside this key so notifications feel like one family.
 */
const BM = {
  B3: 247,
  Cs4: 277,
  D4: 294,
  E4: 330,
  Fs4: 370,
  G4: 392,
  A4: 440,
  B4: 494,
  D5: 587,
  Fs5: 740,
  A5: 880
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
  options: { peak?: number; secondPeak?: number; type?: OscillatorType } = {}
): ToneSpec[] {
  const { peak = 0.052, secondPeak = 0.048, type = 'sine' } = options;

  return [
    { type, freq: first, start: 0, attack: 0.02, decay: 0.14, peak },
    { type, freq: second, start: NOTE_GAP, attack: 0.02, decay: 0.15, peak: secondPeak }
  ];
}

function arpeggio(
  notes: number[],
  options: { peak?: number; type?: OscillatorType } = {}
): ToneSpec[] {
  const { peak = 0.046, type = 'sine' } = options;

  return notes.map((freq, index) => ({
    type,
    freq,
    start: NOTE_GAP * index,
    attack: 0.014,
    decay: 0.11,
    peak: peak - index * 0.002
  }));
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
    void playTonePattern(pairedNotes(BM.Fs4, BM.A4));
    return;
  }

  void playTonePattern(pairedNotes(BM.A4, BM.E4, { secondPeak: 0.044 }));
}

export function playMicCue(muted: boolean): void {
  if (isAppPlaybackMuted()) return;

  if (muted) {
    void playTonePattern([
      { type: 'triangle', freq: BM.Fs4, endFreq: BM.D4, start: 0, attack: 0.014, decay: 0.18, peak: 0.048 }
    ]);
    return;
  }

  void playTonePattern([
    { type: 'triangle', freq: BM.D4, endFreq: BM.Fs4, start: 0, attack: 0.016, decay: 0.2, peak: 0.05 }
  ]);
}

export function playOutputCue(muted: boolean): void {
  if (isLocalAppAudioSuppressed()) return;

  if (muted) {
    void playTonePattern(pairedNotes(BM.Fs4, BM.D4, { peak: 0.04, secondPeak: 0.036 }));
    return;
  }

  void playTonePattern(pairedNotes(BM.D4, BM.Fs4, { peak: 0.042, secondPeak: 0.04 }));
}

export function playStreamCue(type: 'start' | 'stop'): void {
  if (isAppPlaybackMuted()) return;

  if (type === 'start') {
    void playTonePattern(arpeggio([BM.D4, BM.Fs4, BM.A4], { type: 'triangle', peak: 0.048 }));
    return;
  }

  void playTonePattern(arpeggio([BM.A4, BM.Fs4, BM.D4], { peak: 0.042 }));
}

export function playStreamViewerCue(type: 'join' | 'leave'): void {
  if (isAppPlaybackMuted()) return;
  if (!shouldPlayStreamViewerCue(type)) return;

  if (type === 'join') {
    void playTonePattern(pairedNotes(BM.A4, BM.B4, { peak: 0.032, secondPeak: 0.028 }));
    return;
  }

  void playTonePattern([
    { type: 'sine', freq: BM.B4, endFreq: BM.G4, start: 0, attack: 0.01, decay: 0.12, peak: 0.026 }
  ]);
}