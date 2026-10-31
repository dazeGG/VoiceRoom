// How a call sounds, from what each listener actually played: the speech its
// receiver had to make up because packets came late or not at all, after RED,
// Opus FEC, loss concealment and the jitter buffer repaired what they could.
// Loss on the line says what the network did; this says what was heard, so
// Opus with RED needs no loss model of its own. How often the gaps come is
// what makes a voice sound broken, and how long they are is what makes it
// impossible to follow: a 20 ms gap takes a sliver of a sound, a 60 ms one a
// syllable.
//
// A listener cannot tell on its own whose fault a gap is: a packet the speaker
// never got to the server is missing for every listener. The server judges the
// room from all its listeners' reports instead (judgeVoice): a speaker most
// listeners hear badly is the one heard badly, a listener who hears most
// speakers badly is the one hearing badly. The room's pill and the admin panel
// show that one verdict.

import type { NetworkLevel } from './contracts/rooms.ts';

/**
 * Where a listener rated the loss bench (scripts/voice-bench, two runs on
 * 2026-10-31, 22 steps of random loss, bursts and jitter) "noise" and "barely
 * audible", each threshold halfway between the steps on either side of it:
 * - unstable: 10 gaps a minute of speech (clean steps had up to 7, noisy ones
 *   12 and more), at least two in the window so one click is not a trend; or
 *   3 % of the latest poll's speech made up, so a dropout shows at once.
 * - bad: 18 % of the window's speech made up (16.2 % was still followable,
 *   19.4 % was not), or 8 % in gaps of 50 ms and longer (5.5 % of 60 ms gaps
 *   was followable, 10.7 % of 64 ms gaps was not; short gaps ran 24-41 ms).
 * Mouth-to-ear delay past ITU-T G.114's 400 ms makes people talk over each
 * other; it never makes a call bad on its own.
 */
export const VOICE_THRESHOLDS = {
  unstable: { gapsPerSpeechMin: 10, minGaps: 2, pollConcealedPct: 3, mouthToEarMs: 400 },
  bad: { concealedPct: 18, longGapConcealedPct: 8, longGapMs: 50 }
} as const;

/** The window gap rates and the bad levels are read over: five polls, about 15 seconds. */
export const VOICE_WINDOW_POLLS = 5;
/** Opus frames are 20 ms at 48 kHz. */
export const VOICE_SAMPLES_PER_PACKET = 960;
const SAMPLE_RATE = 48_000;
/** Less speech than this (half a second) says nothing about how it sounded. */
export const VOICE_MIN_SPEECH_SAMPLES = 24_000;
/** Capture, a 20 ms frame with the encoder's look-ahead, and playout, on top of the network and the jitter buffer. */
export const VOICE_CODEC_DELAY_MS = 40;

/** One speaker as one listener received it, over one poll or summed over several. */
export interface HeardCounts {
  /** Audio packets that arrived or were lost; silence under DTX sends almost none. */
  packets: number;
  lost: number;
  /** Samples made up for missing packets outside silence. */
  concealedSamples: number;
  /** Times the receiver started making sound up: each one a gap the listener heard. */
  gaps: number;
}

export interface HeardStream {
  senderId: string;
  /** The latest stats poll. */
  latest: HeardCounts;
  /** The last VOICE_WINDOW_POLLS polls, the latest included. */
  window: HeardCounts;
}

/** One peer's stats poll, as its client sends it. */
export interface VoiceReport {
  peerId: string;
  rttMs: number | null;
  /** The average time a played sample waited in the jitter buffer. */
  jitterBufferMs: number | null;
  /** Our packets the server says it never got. */
  uplinkLossPct: number | null;
  heard: readonly HeardStream[];
}

/** Whose side the trouble is on: the peer is heard badly, hears badly, or adds the delay. */
export type VoiceCause = 'heard_badly' | 'hears_badly' | 'delay';

export interface VoiceVerdict {
  level: NetworkLevel;
  cause: VoiceCause | null;
}

const CAUSE_ORDER: readonly VoiceCause[] = ['heard_badly', 'hears_badly', 'delay'];
const RANK: Record<NetworkLevel, number> = { good: 0, unstable: 1, bad: 2 };

const speechSamples = (counts: Pick<HeardCounts, 'packets'>) => Math.max(0, counts.packets) * VOICE_SAMPLES_PER_PACKET;
const concealedOf = (counts: Pick<HeardCounts, 'packets' | 'concealedSamples'>) =>
  Math.min(Math.max(0, counts.concealedSamples), speechSamples(counts));

/** The share of the speech that was made up, in percent; null with too little speech to tell. */
export function concealedSpeechPct(counts: Pick<HeardCounts, 'packets' | 'concealedSamples'>): number | null {
  const speech = speechSamples(counts);
  if (speech < VOICE_MIN_SPEECH_SAMPLES) return null;
  return Math.round((concealedOf(counts) / speech) * 1000) / 10;
}

/** Gaps per minute of speech, as the packets measure it, so pauses do not water it down; null with too little speech. */
export function gapsPerSpeechMin(counts: HeardCounts): number | null {
  const speech = speechSamples(counts);
  if (speech < VOICE_MIN_SPEECH_SAMPLES) return null;
  return Math.max(0, counts.gaps) / (speech / SAMPLE_RATE / 60);
}

/** How long a gap lasted on average, in ms; 0 without gaps. */
export function averageGapMs(counts: HeardCounts): number {
  return counts.gaps > 0 ? (concealedOf(counts) / counts.gaps / SAMPLE_RATE) * 1000 : 0;
}

/** How a speaker sounded to a listener: the window's gaps and their length, and a dropout in the latest poll; null with too little speech. */
export function streamLevel(stream: Pick<HeardStream, 'latest' | 'window'>): NetworkLevel | null {
  const { bad, unstable } = VOICE_THRESHOLDS;
  const concealedPct = concealedSpeechPct(stream.window);
  const rate = gapsPerSpeechMin(stream.window);
  if (concealedPct === null || rate === null) return null;
  const longGaps = averageGapMs(stream.window) >= bad.longGapMs;
  if (concealedPct >= bad.concealedPct || (longGaps && concealedPct >= bad.longGapConcealedPct)) return 'bad';
  const latestPct = concealedSpeechPct(stream.latest);
  if (latestPct !== null && latestPct >= unstable.pollConcealedPct) return 'unstable';
  return stream.window.gaps >= unstable.minGaps && rate >= unstable.gapsPerSpeechMin ? 'unstable' : 'good';
}

/** Mouth to ear: each side's half of its round trip, the listener's jitter buffer and the codec; null without both round trips. */
export function mouthToEarMs(sender: VoiceReport | undefined, listener: VoiceReport): number | null {
  if (sender?.rttMs == null || listener.rttMs == null) return null;
  return sender.rttMs / 2 + listener.rttMs / 2 + (listener.jitterBufferMs ?? 0) + VOICE_CODEC_DELAY_MS;
}

interface JudgedStream {
  listenerId: string;
  senderId: string;
  level: NetworkLevel;
  lossPct: number;
}

/**
 * The verdict for every peer the reports name, speakers who sent none
 * included; null for a peer nothing was heard from or by.
 */
export function judgeVoice(reports: readonly VoiceReport[]): Map<string, VoiceVerdict | null> {
  const byPeer = new Map(reports.map((report) => [report.peerId, report]));
  const verdicts = new Map<string, VoiceVerdict | null>();
  const known = (peerId: string) => {
    if (!verdicts.has(peerId)) verdicts.set(peerId, null);
  };
  const blame = (peerId: string, level: NetworkLevel, cause: VoiceCause) => {
    const current = verdicts.get(peerId) ?? { level: 'good', cause: null };
    verdicts.set(peerId, worseVerdict(current, level === 'good' ? { level, cause: null } : { level, cause }));
  };

  const judged: JudgedStream[] = [];
  for (const listener of reports) {
    known(listener.peerId);
    for (const stream of listener.heard) {
      known(stream.senderId);
      const level = streamLevel(stream);
      if (level === null) continue;
      const { lost, packets } = stream.window;
      const lossPct = packets > 0 ? (Math.max(0, lost) / packets) * 100 : 0;
      judged.push({ listenerId: listener.peerId, senderId: stream.senderId, level, lossPct });
    }
  }

  // Most of a side's judged streams sounding bad; null when one stream cannot tell.
  const mostlyBad = (streams: JudgedStream[]): boolean | null =>
    streams.length < 2 ? null : streams.filter((stream) => stream.level !== 'good').length * 2 > streams.length;

  for (const stream of judged) {
    blame(stream.listenerId, 'good', 'hears_badly');
    blame(stream.senderId, 'good', 'heard_badly');
    if (stream.level === 'good') continue;
    const senderSide = mostlyBad(judged.filter((other) => other.senderId === stream.senderId));
    const listenerSide = mostlyBad(judged.filter((other) => other.listenerId === stream.listenerId));
    let sender: boolean;
    let listener: boolean;
    if (senderSide === null && listenerSide === null) {
      // Two people: the speaker's own line explains the gaps when it lost at least half of what the listener did.
      const uplink = byPeer.get(stream.senderId)?.uplinkLossPct ?? 0;
      sender = stream.lossPct > 0 && uplink * 2 >= stream.lossPct;
      listener = !sender;
    } else {
      sender = senderSide === true;
      listener = listenerSide === true;
      // A pair that sounds bad while both sides sound fine elsewhere is what this listener hears.
      if (!sender && !listener) listener = true;
    }
    if (sender) blame(stream.senderId, stream.level, 'heard_badly');
    if (listener) blame(stream.listenerId, stream.level, 'hears_badly');
  }

  for (const listener of reports) {
    for (const stream of listener.heard) {
      const sender = byPeer.get(stream.senderId);
      const delay = mouthToEarMs(sender, listener);
      // A short delay says nothing of how the call sounds, so only a long one counts.
      if (delay === null || !sender || delay < VOICE_THRESHOLDS.unstable.mouthToEarMs) continue;
      const senderShare = (sender.rttMs ?? 0) / 2;
      const listenerShare = (listener.rttMs ?? 0) / 2 + (listener.jitterBufferMs ?? 0);
      blame(senderShare > listenerShare ? sender.peerId : listener.peerId, 'unstable', 'delay');
    }
  }

  return verdicts;
}

/** The worse of two verdicts; at the same level the cause listed first in CAUSE_ORDER stands. */
function worseVerdict(a: VoiceVerdict, b: VoiceVerdict): VoiceVerdict {
  if (RANK[b.level] !== RANK[a.level]) return RANK[b.level] > RANK[a.level] ? b : a;
  if (!a.cause) return b;
  if (!b.cause) return a;
  return CAUSE_ORDER.indexOf(b.cause) < CAUSE_ORDER.indexOf(a.cause) ? b : a;
}
