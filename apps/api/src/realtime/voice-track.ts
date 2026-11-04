// A room's voice as its peers' stats polls tell it (room.voice.report). Each
// poll says what one listener heard of each speaker since its previous poll;
// the server keeps the last VOICE_WINDOW_POLLS of them per speaker, judges the
// whole room from every listener's window (voice-quality.ts judgeVoice) and
// tells each peer whose verdict changed. The same verdict is what the admin
// panel shows live, and every stay sums its polls into minutes, written with
// the stay when it ends (voice_session_samples).

import type { ClientCommands, CpuPoll } from '@voice-room/shared/contracts/realtime';
import { CPU_PRESSURES, type CpuPressure } from '@voice-room/shared/contracts/rooms';
import {
  VOICE_WINDOW_POLLS,
  judgeVoice,
  type HeardCounts,
  type VoiceReport,
  type VoiceVerdict
} from '@voice-room/shared/voice-quality';
import type {
  MinuteCpu,
  StayEvent,
  StayEventKind,
  VoiceMinuteSample
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

/** A peer's voice: its latest poll, its windows, the verdict and its minutes. */
export interface PeerVoice {
  /** When its latest poll came; null for a speaker known only from its listeners. */
  reportedAt: number | null;
  rttMs: number | null;
  jitterBufferMs: number | null;
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
  /** The pressure its computer last reported; null where its client cannot tell. */
  cpuPressure: CpuPressure | null;
  /** Its call switched to the lighter noise suppression. */
  relieved: boolean;
}

/** What the runtime needs of a room and its peers. */
interface VoicePeer {
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
  rttMs: null,
  jitterBufferMs: null,
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
function reportOf(peer: VoicePeer & { voice: PeerVoice }, inRoom: (peerId: string) => boolean): VoiceReport {
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
    rttMs: voice.rttMs,
    jitterBufferMs: voice.jitterBufferMs,
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
  poll: Pick<VoicePoll, 'rttMs' | 'jitterBufferMs' | 'uplink' | 'transport' | 'heard' | 'mic' | 'cpu'>,
  at: number
): VoiceChange<Peer>[] {
  const voice = (peer.voice ??= emptyVoice());
  const minute = minuteOf(voice, at);

  // A speaker the poll does not name sent nothing since the previous one.
  const polled = new Map<string, HeardCounts>();
  for (const { peerId, ...counts } of poll.heard) {
    if (peerId !== peer.id && peers.has(peerId) && !polled.has(peerId)) polled.set(peerId, counts);
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
    const sender = peers.get(senderId);
    if (sender) addCounts(minuteOf((sender.voice ??= emptyVoice()), at).heardBy, counts);
  }

  voice.uplink.push({ ...poll.uplink });
  keepLast(voice.uplink);
  voice.rttMs = poll.rttMs;
  voice.jitterBufferMs = poll.jitterBufferMs;
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
  if (voice.verdict) minute.polls[voice.verdict.level] += 1;
  return changes;
}

/** Judges the room from the fresh polls of its peers; answers the peers whose verdict changed. */
function judgeRoom<Peer extends VoicePeer>(peers: ReadonlyMap<string, Peer>, at: number): VoiceChange<Peer>[] {
  const reports: VoiceReport[] = [];
  for (const peer of peers.values()) {
    const voice = peer.voice;
    if (voice?.reportedAt == null || at - voice.reportedAt > VOICE_REPORT_STALE_MS) continue;
    reports.push(reportOf({ id: peer.id, voice }, (peerId) => peers.has(peerId)));
  }
  const verdicts = judgeVoice(reports);
  const changes: VoiceChange<Peer>[] = [];
  for (const peer of peers.values()) {
    const verdict = verdicts.get(peer.id) ?? null;
    if (!peer.voice && !verdict) continue;
    const voice = (peer.voice ??= emptyVoice());
    voice.verdict = verdict;
    if (sameVerdict(voice.told, verdict)) continue;
    voice.told = verdict;
    changes.push({ peer, verdict });
  }
  return changes;
}

/** A rejoining peer keeps its minutes; its new socket is told the verdict afresh. */
export function rejoinedVoice(voice: PeerVoice | undefined): PeerVoice | undefined {
  return voice && { ...voice, told: undefined };
}

/** The verdict on a peer's voice now; null while nothing was heard from or by it. */
export const currentVoice = (peer: VoicePeer): VoiceVerdict | null => peer.voice?.verdict ?? null;
