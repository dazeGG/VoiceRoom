// How a call sounds, from what each listener actually played: the share of a
// speaker's speech its receiver had to make up because packets came late or
// not at all, after RED, Opus FEC, loss concealment and the jitter buffer
// repaired what they could. Loss on the line says what the network did; this
// says what was heard, so Opus with RED needs no loss model of its own.
//
// A listener cannot tell on its own whose fault a gap is: a packet the speaker
// never got to the server is missing for every listener. The server judges the
// room from all its listeners' reports instead (judgeVoice): a speaker most
// listeners hear badly is the one heard badly, a listener who hears most
// speakers badly is the one hearing badly. The room's pill and the admin panel
// show that one verdict.

import type { NetworkLevel } from './contracts/rooms.ts';
import { CONCEALMENT_THRESHOLDS } from './network-quality.ts';

/**
 * Concealed speech a listener hears as gaps, and past `bad` as speech breaking
 * up. Mouth-to-ear delay past ITU-T G.114's 400 ms makes people talk over each
 * other; it never makes a call bad on its own. Starting values: the loss bench
 * (netem, random and bursty loss) sets the final ones.
 */
export const VOICE_THRESHOLDS = {
  unstable: { concealedPct: CONCEALMENT_THRESHOLDS.noticeablePct, mouthToEarMs: 400 },
  bad: { concealedPct: 15 }
} as const;

/** Opus frames are 20 ms at 48 kHz. */
export const VOICE_SAMPLES_PER_PACKET = 960;
/** Less speech than this in a poll (half a second) says nothing about how it sounded. */
export const VOICE_MIN_SPEECH_SAMPLES = 24_000;
/** Capture, a 20 ms frame with the encoder's look-ahead, and playout, on top of the network and the jitter buffer. */
export const VOICE_CODEC_DELAY_MS = 40;

/** One speaker as one listener received it over one stats poll. */
export interface HeardStream {
  senderId: string;
  /** Audio packets that arrived or were lost; silence under DTX sends almost none. */
  packets: number;
  lost: number;
  /** Samples made up for missing packets outside silence. */
  concealedSamples: number;
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

/** The share of a stream's speech that was made up, in percent; null with too little speech to tell. */
export function concealedSpeechPct(stream: Pick<HeardStream, 'packets' | 'concealedSamples'>): number | null {
  const speech = Math.max(0, stream.packets) * VOICE_SAMPLES_PER_PACKET;
  if (speech < VOICE_MIN_SPEECH_SAMPLES) return null;
  const concealed = Math.min(Math.max(0, stream.concealedSamples), speech);
  return Math.round((concealed / speech) * 1000) / 10;
}

export function concealedLevel(pct: number): NetworkLevel {
  if (pct >= VOICE_THRESHOLDS.bad.concealedPct) return 'bad';
  if (pct >= VOICE_THRESHOLDS.unstable.concealedPct) return 'unstable';
  return 'good';
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
      const pct = concealedSpeechPct(stream);
      if (pct === null) continue;
      const lossPct = stream.packets > 0 ? (Math.max(0, stream.lost) / stream.packets) * 100 : 0;
      judged.push({ listenerId: listener.peerId, senderId: stream.senderId, level: concealedLevel(pct), lossPct });
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
