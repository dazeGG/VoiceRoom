// A room's voice as its peers' stats polls tell it (room.voice.report). Each
// poll says what one listener heard of each speaker since its previous poll;
// the server keeps the last VOICE_WINDOW_POLLS of them per speaker, judges the
// whole room from every listener's window (voice-quality.ts judgeVoice) and
// tells each peer whose verdict changed. The same verdict is what the admin
// panel shows live, and every stay sums its polls into minutes, written with
// the stay when it ends (voice_session_samples).

import type { ClientCommands, CpuPoll, JoinTiming } from '@voice-room/shared/contracts/realtime';
import { CPU_PRESSURES, type CpuPressure } from '@voice-room/shared/contracts/rooms';
import {
  VOICE_WINDOW_POLLS,
  concealedSpeechPct,
  heardGaps,
  judgeVoice,
  type HeardCounts,
  type VoiceReport,
  type VoiceVerdict
} from '@voice-room/shared/voice-quality';
import type {
  MinuteCpu,
  StayEvent,
  StayEventKind,
  VoiceMinuteSample,
  WorstWindow
} from '../domains/rooms/voice-session.repository.ts';

type VoicePoll = ClientCommands['room.voice.report'];
type Uplink = VoiceMinuteSample['uplink'];

/** A poll older than this (three missed polls) no longer speaks for its listener: a hidden tab stops polling. */
export const VOICE_REPORT_STALE_MS = 10_000;
/** A stay keeps this many minutes (12 hours); past it the oldest go. */
export const VOICE_MINUTES_MAX = 720;
/** A stay keeps this many events; past it the oldest go. */
export const VOICE_EVENTS_MAX = 200;
const MINUTE_MS = 60_000;
/** Fewer measured polls than this say nothing of a delay: it settles over the first seconds of a call. */
const DELAY_MIN_POLLS = 3;
// RTCP may publish a real round trip only every 4–7 s. Three real samples
// need a wider window, while the last-receipt limit still expires stale RTT.
const RTT_LAST_RECEIPT_MS = 9000;
const RTT_SAMPLE_AGE_MS = 20_000;
/** A poll covers three seconds, so one heard this soon after a microphone changed can hold the change. */
const MIC_SETTLE_MS = 4000;

/** A peer's voice: its latest polls, its windows, the verdict and its minutes. */
export interface PeerVoice {
  /** When its latest poll came; null for a speaker known only from its listeners. */
  reportedAt: number | null;
  /** The last VOICE_WINDOW_POLLS polls' round trip and jitter buffer, the latest last. */
  rttPolls: { value: number; at: number }[];
  jitterBufferPolls: (number | null)[];
  /** Per speaker, the counts of the last VOICE_WINDOW_POLLS polls, the latest last. */
  heard: Map<string, HeardCounts[]>;
  uplink: Uplink[];
  verdict: VoiceVerdict | null;
  /** The verdict the peer's socket was last sent; undefined until one is. */
  told?: VoiceVerdict | null | undefined;
  /** Its minutes, oldest first, the running one last. */
  minutes: VoiceMinuteSample[];
  /** What its seat did, oldest first. */
  events: StayEvent[];
  /** How its join went, once its client has said. */
  joinTiming?: JoinTiming | undefined;
  /** The pressure its computer last reported; null where its client cannot tell. */
  cpuPressure: CpuPressure | null;
  /** Its call switched to the lighter noise suppression. */
  relieved: boolean;
  /** When its microphone last went on or off. */
  micChangedAt?: number | undefined;
}

/** What the runtime needs of a room and its peers. */
export interface VoicePeer {
  id: string;
  voice?: PeerVoice | undefined;
}

/** A peer whose verdict changed, to be told. */
export interface VoiceChange<Peer> {
  peer: Peer;
  verdict: VoiceVerdict | null;
}

const NO_COUNTS: HeardCounts = { packets: 0, lost: 0, concealedSamples: 0, gaps: 0 };

const emptyVoice = (): PeerVoice => ({
  reportedAt: null,
  rttPolls: [],
  jitterBufferPolls: [],
  heard: new Map(),
  uplink: [],
  verdict: null,
  minutes: [],
  events: [],
  cpuPressure: null,
  relieved: false
});

const pushEvent = (voice: PeerVoice, kind: StayEventKind, at: number) => {
  voice.events.push({ at, kind });
  if (voice.events.length > VOICE_EVENTS_MAX) voice.events.shift();
};

/** Keeps something a peer's seat did with its stay: a screen or a camera going on or off. */
export function noteStayEvent(peer: VoicePeer, kind: StayEventKind, at: number): void {
  pushEvent((peer.voice ??= emptyVoice()), kind, at);
}

/** A peer's microphone went on or off: see micChanging. */
export function noteMicChange(peer: VoicePeer, at: number): void {
  (peer.voice ??= emptyVoice()).micChangedAt = at;
}

const higherPressure = (a: CpuPressure | null, b: CpuPressure | null): CpuPressure | null => {
  if (!a || !b) return a ?? b;
  return CPU_PRESSURES.indexOf(a) >= CPU_PRESSURES.indexOf(b) ? a : b;
};

/** Sums a poll's computer into the minute and marks where it first overloaded or got relief. */
function noteCpu(voice: PeerVoice, minute: VoiceMinuteSample, poll: CpuPoll, at: number): void {
  const cpu: MinuteCpu = (minute.cpu ??= {
    appPctSum: 0,
    systemPctSum: 0,
    polls: 0,
    pressureMax: null,
    relieved: false
  });
  if (poll.appPct !== null && poll.systemPct !== null) {
    cpu.appPctSum += poll.appPct;
    cpu.systemPctSum += poll.systemPct;
    cpu.polls += 1;
  }
  cpu.pressureMax = higherPressure(cpu.pressureMax, poll.pressure);
  cpu.relieved ||= poll.relieved;
  if (poll.pressure === 'critical' && voice.cpuPressure !== 'critical') pushEvent(voice, 'cpu_critical', at);
  if (poll.relieved && !voice.relieved) pushEvent(voice, 'relieved_ns', at);
  voice.cpuPressure = poll.pressure;
  voice.relieved ||= poll.relieved;
}

const sameVerdict = (a: VoiceVerdict | null | undefined, b: VoiceVerdict | null) =>
  a !== undefined && a?.level === b?.level && a?.cause === b?.cause;

const keepLast = (items: unknown[]) => {
  if (items.length > VOICE_WINDOW_POLLS) items.splice(0, items.length - VOICE_WINDOW_POLLS);
};

/**
 * What most of the latest polls measured at least: over five, three of them.
 * A single spike of a round trip or a buffer is not a long delay, as Twilio's
 * voice SDK reads each of its warnings over three of its last five samples.
 * The round trip is measured every poll, so too few polls mean the call has only
 * begun; the buffer only while someone speaks, so one reading has to do.
 */
function settled(polls: readonly (number | null)[], minPolls: number): number | null {
  const measured = polls.filter((value) => value !== null).sort((a, b) => a - b);
  if (measured.length < minPolls) return null;
  return measured[Math.floor((measured.length - 1) / 2)] ?? null;
}

function settledRtt(voice: PeerVoice, at: number): number | null {
  const latest = voice.rttPolls.at(-1);
  if (latest && at - latest.at >= RTT_LAST_RECEIPT_MS) voice.rttPolls = [];
  else voice.rttPolls = voice.rttPolls.filter((sample) => at - sample.at < RTT_SAMPLE_AGE_MS);
  return settled(
    voice.rttPolls.map((sample) => sample.value),
    DELAY_MIN_POLLS
  );
}

/**
 * A speaker's microphone went on or off within the poll. LiveKit stops forwarding
 * a muted microphone, and its listeners' receivers make up its last moment, with
 * nothing wrong on any line. While it stays off nothing is made up (those events
 * are silence, which heardGaps drops), so only the change itself is skipped, and a
 * `muted` left over from before a reconnect never hides a voice breaking up.
 */
const micChanging = (sender: VoicePeer, at: number) => {
  const changedAt = sender.voice?.micChangedAt;
  return changedAt !== undefined && at - changedAt < MIC_SETTLE_MS;
};

/** Keeps the worst of the windows a minute saw of any one speaker, each number on its own. */
function worseWindow(worst: WorstWindow | undefined, window: HeardCounts): WorstWindow | undefined {
  const concealedPct = concealedSpeechPct(window);
  if (concealedPct === null) return worst;
  return {
    concealedPct: Math.max(worst?.concealedPct ?? 0, concealedPct),
    gaps: Math.max(worst?.gaps ?? 0, heardGaps(window))
  };
}

/** The running minute of a stay at `at`, started when the clock passed into a new one. */
function minuteOf(voice: PeerVoice, at: number): VoiceMinuteSample {
  const start = Math.floor(at / MINUTE_MS) * MINUTE_MS;
  const last = voice.minutes.at(-1);
  if (last && last.at >= start) return last;
  const minute: VoiceMinuteSample = {
    at: start,
    polls: { good: 0, unstable: 0, bad: 0 },
    heard: { ...NO_COUNTS },
    heardBy: { ...NO_COUNTS },
    rttMsSum: 0,
    rttPolls: 0,
    jitterBufferMsSum: 0,
    jitterBufferPolls: 0,
    uplink: { packets: 0, lost: 0 },
    mic: { expectedMs: 0, deliveredMs: 0, contextMs: 0, reopens: 0, replacements: 0 },
    transport: null
  };
  voice.minutes.push(minute);
  if (voice.minutes.length > VOICE_MINUTES_MAX) voice.minutes.shift();
  return minute;
}

function addCounts(total: HeardCounts, counts: HeardCounts): HeardCounts {
  total.packets += counts.packets;
  total.lost += counts.lost;
  total.concealedSamples += counts.concealedSamples;
  total.gaps += counts.gaps;
  return total;
}

/** The listener's report as judgeVoice reads it, over the speakers still in the room. */
function reportOf(
  peer: VoicePeer & { voice: PeerVoice },
  inRoom: (peerId: string) => boolean,
  at: number
): VoiceReport {
  const { voice } = peer;
  const uplink = voice.uplink.reduce(
    (total, poll) => ({ packets: total.packets + poll.packets, lost: total.lost + poll.lost }),
    {
      packets: 0,
      lost: 0
    }
  );
  return {
    peerId: peer.id,
    rttMs: settledRtt(voice, at),
    jitterBufferMs: settled(voice.jitterBufferPolls, 1),
    uplinkLossPct: uplink.packets > 0 ? (uplink.lost / uplink.packets) * 100 : null,
    heard: [...voice.heard]
      .filter(([senderId]) => inRoom(senderId))
      .map(([senderId, polls]) => ({
        senderId,
        latest: polls.at(-1) ?? NO_COUNTS,
        window: polls.reduce(addCounts, { ...NO_COUNTS })
      }))
  };
}

/**
 * Takes `peer`'s poll, heard at `at`, into the room's windows and minutes and
 * judges the room again; answers the peers whose verdict changed.
 */
export function noteVoiceReport<Peer extends VoicePeer>(
  peers: ReadonlyMap<string, Peer>,
  peer: Peer,
  poll: Pick<
    VoicePoll,
    'rttMs' | 'rttUnchanged' | 'jitterBufferMs' | 'uplink' | 'transport' | 'heard' | 'mic' | 'cpu' | 'joinTiming'
  >,
  at: number
): VoiceChange<Peer>[] {
  const voice = (peer.voice ??= emptyVoice());
  if (poll.joinTiming) voice.joinTiming = poll.joinTiming;
  const minute = minuteOf(voice, at);

  // A speaker the poll does not name sent nothing since the previous one, and
  // one whose microphone was changing said nothing we can judge. Only here, poll
  // by poll, can the events spent on silence be told from gaps.
  const polled = new Map<string, HeardCounts>();
  for (const { peerId, ...counts } of poll.heard) {
    const sender = peers.get(peerId);
    if (peerId !== peer.id && sender && !polled.has(peerId)) {
      polled.set(peerId, micChanging(sender, at) ? NO_COUNTS : { ...counts, gaps: heardGaps(counts) });
    }
  }
  for (const senderId of voice.heard.keys()) if (!polled.has(senderId)) polled.set(senderId, NO_COUNTS);
  for (const [senderId, counts] of polled) {
    const polls = voice.heard.get(senderId) ?? [];
    polls.push(counts);
    keepLast(polls);
    if (!peers.has(senderId) || polls.every((counts) => counts.packets === 0)) voice.heard.delete(senderId);
    else voice.heard.set(senderId, polls);
    if (counts === NO_COUNTS) continue;
    addCounts(minute.heard, counts);
    const window = polls.reduce(addCounts, { ...NO_COUNTS });
    minute.worstHeard = worseWindow(minute.worstHeard, window);
    const sender = peers.get(senderId);
    if (!sender) continue;
    const senderMinute = minuteOf((sender.voice ??= emptyVoice()), at);
    addCounts(senderMinute.heardBy, counts);
    senderMinute.worstHeardBy = worseWindow(senderMinute.worstHeardBy, window);
  }

  voice.uplink.push({ ...poll.uplink });
  keepLast(voice.uplink);
  // An explicit unknown resets settlement; unchanged merely ages real samples.
  settledRtt(voice, at);
  if (poll.rttMs === null && poll.rttUnchanged !== true) voice.rttPolls = [];
  else if (poll.rttMs !== null) {
    voice.rttPolls.push({ value: poll.rttMs, at });
    keepLast(voice.rttPolls);
  }
  voice.jitterBufferPolls.push(poll.jitterBufferMs);
  keepLast(voice.jitterBufferPolls);
  voice.reportedAt = at;
  if (poll.rttMs !== null) {
    minute.rttMsSum += poll.rttMs;
    minute.rttPolls += 1;
  }
  if (poll.jitterBufferMs !== null) {
    minute.jitterBufferMsSum += poll.jitterBufferMs;
    minute.jitterBufferPolls += 1;
  }
  minute.uplink.packets += poll.uplink.packets;
  minute.uplink.lost += poll.uplink.lost;
  if (poll.mic) {
    minute.mic.expectedMs += poll.mic.expectedMs;
    minute.mic.deliveredMs += poll.mic.deliveredMs;
    minute.mic.contextMs += poll.mic.contextMs;
    minute.mic.reopens += poll.mic.reopens;
    minute.mic.replacements += poll.mic.replacements;
  }
  minute.transport = poll.transport ?? minute.transport;
  if (poll.cpu) noteCpu(voice, minute, poll.cpu, at);

  const changes = judgeRoom(peers, at);
  if (voice.verdict) {
    minute.polls[voice.verdict.level] += 1;
    if (voice.verdict.cause) {
      minute.causes ??= { heard_badly: 0, hears_badly: 0, delay: 0 };
      minute.causes[voice.verdict.cause] += 1;
    }
  }
  return changes;
}

/** Judges the room from the fresh polls of its peers; answers the peers whose verdict changed. */
function judgeRoom<Peer extends VoicePeer>(
  peers: ReadonlyMap<string, Peer>,
  at: number,
  notify = true
): VoiceChange<Peer>[] {
  const reports: VoiceReport[] = [];
  for (const peer of peers.values()) {
    const voice = peer.voice;
    if (voice) settledRtt(voice, at);
    if (voice?.reportedAt == null || at - voice.reportedAt > VOICE_REPORT_STALE_MS) continue;
    reports.push(reportOf({ id: peer.id, voice }, (peerId) => peers.has(peerId), at));
  }
  const verdicts = judgeVoice(reports);
  const changes: VoiceChange<Peer>[] = [];
  for (const peer of peers.values()) {
    const verdict = verdicts.get(peer.id) ?? null;
    if (!peer.voice && !verdict) continue;
    const voice = (peer.voice ??= emptyVoice());
    voice.verdict = verdict;
    if (!notify) continue;
    if (sameVerdict(voice.told, verdict)) continue;
    voice.told = verdict;
    changes.push({ peer, verdict });
  }
  return changes;
}

/** Re-evaluate at the query clock: receipt/sample expiry must precede an admin read too. */
export function refreshVoice<Peer extends VoicePeer>(peers: ReadonlyMap<string, Peer>, at: number): void {
  judgeRoom(peers, at, false);
}

/** A rejoining peer keeps its minutes; its new socket is told the verdict afresh. */
export function rejoinedVoice(voice: PeerVoice | undefined): PeerVoice | undefined {
  return voice && { ...voice, rttPolls: [], told: undefined };
}

/** The verdict on a peer's voice now; null while nothing was heard from or by it. */
export const currentVoice = (peer: VoicePeer): VoiceVerdict | null => peer.voice?.verdict ?? null;
