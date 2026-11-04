// Finished stays in a room's voice, kept for usage numbers and, while they
// still carry their room, the admin panel's room history. The only writer of
// voice_sessions (the account deletion purge aside).
//
// A stay says who and where from without an IP address or a city: the address
// only yields its keyed hash (see DescribeAddress), which tells addresses apart
// for bans and quotas; the city is shown for people in voice now, never kept.
// Its voice minutes (voice_session_samples) are written with it.

import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import type { ClientKind } from '@voice-room/shared/contracts/admin';
import type { CpuPressure, VoiceCause } from '@voice-room/shared/contracts/rooms';
import type { VoiceTransport } from '@voice-room/shared/contracts/realtime';
import type { HeardCounts } from '@voice-room/shared/voice-quality';
import { kyselyOn } from '../../platform/db/kysely.ts';

/** One minute of a stay's voice, summed by the server from its stats polls (realtime/voice-track.ts). */
export type VoiceMinuteSample = {
  /** The minute's start. */
  at: number;
  /** The peer's own polls by the verdict it was given at each. */
  polls: { good: number; unstable: number; bad: number };
  /** Why those polls were not good; absent while none was. */
  causes?: Record<VoiceCause, number> | undefined;
  /** What the peer heard of every speaker, and what its listeners heard of it. */
  heard: HeardCounts;
  heardBy: HeardCounts;
  /** The worst window of any one speaker on each side, which the sums above water down; absent with too little speech. */
  worstHeard?: WorstWindow | undefined;
  worstHeardBy?: WorstWindow | undefined;
  rttMsSum: number;
  rttPolls: number;
  jitterBufferMsSum: number;
  jitterBufferPolls: number;
  uplink: { packets: number; lost: number };
  /** How its microphone reached the encoder; all zero while it was muted or the browser did not say. */
  mic: { expectedMs: number; deliveredMs: number; contextMs: number; reopens: number; replacements: number };
  /** The latest the minute saw. */
  transport: VoiceTransport | null;
  /** How its computer did, summed like the rest; absent while its client said nothing of it. */
  cpu?: MinuteCpu | undefined;
};

/** The most of a minute's windows of one speaker: each number is the highest it saw, not always of the same window. */
export type WorstWindow = { concealedPct: number; gaps: number };

export type MinuteCpu = {
  appPctSum: number;
  systemPctSum: number;
  /** The polls behind the two sums. */
  polls: number;
  /** The highest pressure the minute saw. */
  pressureMax: CpuPressure | null;
  /** The lighter noise suppression was on. */
  relieved: boolean;
};

/** What the stay's seat did that the stay itself does not say (voice_call_events). */
export type StayEventKind = 'screen_on' | 'screen_off' | 'camera_on' | 'camera_off' | 'cpu_critical' | 'relieved_ns';
export type StayEvent = { at: number; kind: StayEventKind };

export type FinishedVoiceSession = {
  roomId: string;
  /** The account, or null for a guest. */
  userId: string | null;
  /** The name a guest gave; null for an account. */
  guestName: string | null;
  /** A guest's lasting browser id; null when it sent none. */
  guestId: string | null;
  client: ClientKind | null;
  /** The system and browser the socket named; empty when it named none. */
  os: string;
  browser: string;
  /** The address the seat came from, in memory only. */
  ip: string;
  joinedAt: number;
  leftAt: number;
  /** Its voice, minute by minute; none when it sent no stats. */
  minutes?: readonly VoiceMinuteSample[];
  events?: readonly StayEvent[];
};

/** What a stay keeps of its address: its keyed hash (lib/ip-key.ts) and its city. */
export type DescribeAddress = (ip: string) => Promise<{ ipKey: string | null; location: string }>;

const NO_ORIGIN: DescribeAddress = () => Promise.resolve({ ipKey: null, location: '' });

export function createVoiceSessionRepository({
  pool,
  describeAddress = NO_ORIGIN
}: {
  pool: pg.Pool;
  describeAddress?: DescribeAddress | undefined;
}) {
  const db = kyselyOn(pool);

  async function recordSessions(sessions: FinishedVoiceSession[]): Promise<void> {
    if (sessions.length === 0) return;
    const origins = await Promise.all(sessions.map((session) => describeAddress(session.ip)));
    // The ids are made here so the minutes find their stay without trusting the order rows come back in.
    const ids = sessions.map(() => crypto.randomUUID());
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('voice_sessions')
        .values(
          sessions.map((session, index) => ({
            id: ids[index],
            room_id: session.roomId,
            user_id: session.userId,
            guest_name: session.userId ? null : session.guestName,
            guest_id: (!session.userId && session.guestId) || null,
            client: session.client,
            os: session.os || null,
            browser: session.browser || null,
            ip_key: origins[index]?.ipKey ?? null,
            joined_at: new Date(session.joinedAt),
            left_at: new Date(Math.max(session.leftAt, session.joinedAt))
          }))
        )
        .execute();
      const samples = sessions.flatMap((session, index) =>
        (session.minutes ?? []).map((minute) => sampleRow(ids[index] ?? '', minute))
      );
      for (let start = 0; start < samples.length; start += SAMPLE_BATCH) {
        await trx
          .insertInto('voice_session_samples')
          .values(samples.slice(start, start + SAMPLE_BATCH))
          .execute();
      }
      const events = sessions.flatMap((session, index) =>
        (session.events ?? []).map((event) => ({
          stay_id: ids[index] ?? '',
          at: new Date(event.at),
          kind: event.kind
        }))
      );
      for (let start = 0; start < events.length; start += SAMPLE_BATCH) {
        await trx
          .insertInto('voice_call_events')
          .values(events.slice(start, start + SAMPLE_BATCH))
          .execute();
      }
    });
  }

  /**
   * Clears the room of every stay that began before the cutoff (the indexed end),
   * and with it whose and where from it was; answers how many.
   */
  async function forgetRoomsBefore(cutoff: Date): Promise<number> {
    return db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('voice_call_events')
        .where('stay_id', 'in', (eb) =>
          eb.selectFrom('voice_sessions').select('id').where('room_id', 'is not', null).where('joined_at', '<', cutoff)
        )
        .execute();
      await trx
        .deleteFrom('voice_session_samples')
        .where('stay_id', 'in', (eb) =>
          eb.selectFrom('voice_sessions').select('id').where('room_id', 'is not', null).where('joined_at', '<', cutoff)
        )
        .execute();
      const result = await trx
        .updateTable('voice_sessions')
        .set({ room_id: null, guest_name: null, guest_id: null, ip_key: null, location: null, network: null })
        .where('room_id', 'is not', null)
        .where('joined_at', '<', cutoff)
        .executeTakeFirst();
      return Number(result.numUpdatedRows);
    });
  }

  /**
   * Stays that began before the Moscow midnight of `cutoffDay` (YYYY-MM-DD)
   * stop saying whose they were and from what device: only the time is left.
   * Counted first by admin-stats rollUp; answers how many changed.
   */
  async function forgetAccountsBefore(cutoffDay: string): Promise<number> {
    const result = await db
      .updateTable('voice_sessions')
      .set({ user_id: null, client: null, os: null, browser: null })
      .where('joined_at', '<', sql<Date>`(${cutoffDay}::date)::timestamp AT TIME ZONE 'Europe/Moscow'`)
      .where((eb) =>
        eb.or([
          eb('user_id', 'is not', null),
          eb('client', 'is not', null),
          eb('os', 'is not', null),
          eb('browser', 'is not', null)
        ])
      )
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  return Object.freeze({ recordSessions, forgetRoomsBefore, forgetAccountsBefore });
}

export type VoiceSessionRepository = ReturnType<typeof createVoiceSessionRepository>;

// A row is 30 values, so this keeps a long call's minutes well under the 65535 parameters of one statement.
const SAMPLE_BATCH = 1000;

// The columns are 4-byte integers; a client's counts are bounded per poll, not per minute.
const int = (value: number) => Math.min(Math.max(0, Math.round(value)), 2_147_483_647);

function sampleRow(stayId: string, minute: VoiceMinuteSample) {
  return {
    stay_id: stayId,
    at: new Date(minute.at),
    polls_good: int(minute.polls.good),
    polls_unstable: int(minute.polls.unstable),
    polls_bad: int(minute.polls.bad),
    polls_heard_badly: int(minute.causes?.heard_badly ?? 0),
    polls_hears_badly: int(minute.causes?.hears_badly ?? 0),
    polls_delay: int(minute.causes?.delay ?? 0),
    heard_worst_concealed_pct: minute.worstHeard?.concealedPct ?? null,
    heard_worst_gaps: int(minute.worstHeard?.gaps ?? 0),
    heard_by_worst_concealed_pct: minute.worstHeardBy?.concealedPct ?? null,
    heard_by_worst_gaps: int(minute.worstHeardBy?.gaps ?? 0),
    heard_packets: int(minute.heard.packets),
    heard_lost: int(minute.heard.lost),
    heard_concealed: int(minute.heard.concealedSamples),
    heard_gaps: int(minute.heard.gaps),
    heard_by_packets: int(minute.heardBy.packets),
    heard_by_lost: int(minute.heardBy.lost),
    heard_by_concealed: int(minute.heardBy.concealedSamples),
    heard_by_gaps: int(minute.heardBy.gaps),
    rtt_ms_sum: minute.rttMsSum,
    rtt_polls: int(minute.rttPolls),
    jitter_buffer_ms_sum: minute.jitterBufferMsSum,
    jitter_buffer_polls: int(minute.jitterBufferPolls),
    uplink_packets: int(minute.uplink.packets),
    uplink_lost: int(minute.uplink.lost),
    mic_expected_ms: int(minute.mic.expectedMs),
    mic_delivered_ms: int(minute.mic.deliveredMs),
    mic_context_ms: int(minute.mic.contextMs),
    mic_reopens: int(minute.mic.reopens),
    mic_replacements: int(minute.mic.replacements),
    transport: minute.transport,
    cpu_app_pct_sum: minute.cpu?.appPctSum ?? 0,
    cpu_system_pct_sum: minute.cpu?.systemPctSum ?? 0,
    cpu_polls: int(minute.cpu?.polls ?? 0),
    cpu_pressure_max: minute.cpu?.pressureMax ?? null,
    cpu_relieved: minute.cpu?.relieved ?? false
  };
}
