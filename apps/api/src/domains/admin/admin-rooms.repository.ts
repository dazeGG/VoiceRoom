// What the admin panel's rooms section reads from the tables: the rooms and
// accounts behind the live presence roster, and the finished stays in voice
// that still carry their room, one by one or gathered into calls, with their
// voice minute by minute. Read only; never a message or an address.

import { sql } from 'kysely';
import type pg from 'pg';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import {
  ROOM_CALLS_PAGE_SIZE,
  ROOM_HISTORY_PAGE_SIZE,
  STATIC_ROOMS_PAGE_SIZE,
  TROUBLE_BAD_PCT,
  type ClientKind,
  type RoomAccount,
  type StaticRoomRow,
  type StaticRoomsFilter,
  type StaticRoomsSort,
  type VoiceMinute,
  type VoiceMinuteHeard,
  type VoiceQuality
} from '@voice-room/shared/contracts/admin';
import { NetworkPoint, type CpuPressure, type NetworkLevel } from '@voice-room/shared/contracts/rooms';
import {
  concealedSpeechPct,
  gapsPerSpeechMin,
  speechSeconds,
  type HeardCounts
} from '@voice-room/shared/voice-quality';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { escapeLike } from '../../platform/db/like.ts';
import { toMillis } from '../../platform/epoch-millis.ts';
import { avatarUrl } from '../../lib/avatar-url.ts';
import type { StayEvent, StayEventKind, VoiceMinuteSample, WorstWindow } from '../rooms/voice-session.repository.ts';

export interface AdminRoomRow {
  id: string;
  name: string;
  isStatic: boolean;
  avatarUrl: string | null;
  owner: RoomAccount | null;
}

export interface StoredStay {
  id: string;
  roomId: string;
  roomName: string | null;
  isStatic: boolean | null;
  account: RoomAccount | null;
  guestName: string | null;
  guestId: string | null;
  client: ClientKind | null;
  os: string | null;
  browser: string | null;
  ipKey: string | null;
  location: string | null;
  joinedAt: number;
  leftAt: number;
  network: NetworkPoint[];
  minutes: VoiceMinute[];
}

export interface StoredCall {
  id: string;
  roomId: string;
  roomName: string | null;
  isStatic: boolean | null;
  avatarUrl: string | null;
  startedAt: number;
  endedAt: number;
  stays: StoredStay[];
  /** Bad answers given about it. */
  badFeedback?: number;
  /** Answers about it come before this moment: FEEDBACK_AFTER_CALL_MS after it, or the room's next call. */
  feedbackUntil?: number;
}

export interface StaticRoomsListQuery {
  q: string;
  filter: StaticRoomsFilter;
  sort: StaticRoomsSort;
  order: 'asc' | 'desc';
  page: number;
  /** The rooms with someone in voice now. */
  liveIds: string[];
}

/** Whose stay in which room to find, ending around `at` (see lastStays). */
export interface StayAsk {
  roomId: string;
  /** The account, or null to look for a guest's browser. */
  userId: string | null;
  guestId: string | null;
  at: number;
}

// The stay is written when the seat closes, which a dropped socket's reconnect
// lease holds off past the moment its owner already answered.
const STAY_ENDS_AFTER_MS = 5 * 60_000;
const STAY_ENDS_BEFORE_MS = 24 * 60 * 60_000;
/** An answer belongs to the call it came during or this soon after, unless the room's next call began first. */
export const FEEDBACK_AFTER_CALL_MS = 30 * 60_000;

/**
 * The joined_at index narrows the stays of the last 30 days; no stay lasts the two days more.
 * Their minutes are then found by their stay, which keeps these reads off the whole of the samples.
 */
export const RECENT_STAYS_DAYS = sql.lit(32);

/** A minute's level in SQL, as minuteLevel reads it: over the rows of voice_session_samples `m`. */
export const QUALITY_COLUMNS = sql`
  count(*) FILTER (WHERE m.polls_bad < 2 AND NOT (m.polls_bad + m.polls_unstable >= 2
      AND (m.polls_bad + m.polls_unstable) * 3 >= m.polls_good + m.polls_unstable + m.polls_bad)
    AND m.polls_good + m.polls_unstable + m.polls_bad > 0) AS good,
  count(*) FILTER (WHERE m.polls_bad < 2 AND m.polls_bad + m.polls_unstable >= 2
    AND (m.polls_bad + m.polls_unstable) * 3 >= m.polls_good + m.polls_unstable + m.polls_bad) AS unstable,
  count(*) FILTER (WHERE m.polls_bad >= 2) AS bad`;

/** The minutes of each level as counted by QUALITY_COLUMNS; null without any. */
export function qualityOf(row: { good?: unknown; unstable?: unknown; bad?: unknown }): VoiceQuality | null {
  const good = Number(row.good) || 0;
  const unstable = Number(row.unstable) || 0;
  const bad = Number(row.bad) || 0;
  return good + unstable + bad > 0 ? { good, unstable, bad } : null;
}

/** Where a page of history continues: the end and id of the last stay (or call) already shown. */
export interface HistoryAfter {
  leftAt: number;
  id: string;
}

// The column only ever holds these four (voice_sessions_client_check).
function clientOf(value: string | null): ClientKind | null {
  return value === 'desktop_app' || value === 'mobile_app' || value === 'mobile' || value === 'browser' ? value : null;
}

type AccountColumns = {
  id: string | null;
  login: string | null;
  display_name: string | null;
  avatar_key: string | null;
  avatar_color_key: string | null;
  avatar_accent: string | null;
};

function account(row: AccountColumns): RoomAccount | null {
  if (!row.id || !row.login) return null;
  return {
    id: row.id,
    login: row.login,
    displayName: row.display_name || row.login,
    avatarUrl: avatarUrl(row.avatar_key),
    avatarColorKey: row.avatar_color_key || 'blurple',
    avatarAccent: row.avatar_accent
  };
}

const NetworkPoints = Type.Array(NetworkPoint);

/** The column holds what voice-session.repository wrote; anything else reads as no changes. */
const networkOf = (value: unknown): NetworkPoint[] => (Value.Check(NetworkPoints, value) ? value : []);

/**
 * A minute's level from the peer's own polls: two bad make it bad, and at least
 * two not good that are also a third of them make it unstable. One trouble stays
 * in the 15 second window for five polls of a minute's twenty, so on its own it
 * shows in the minute's numbers and does not colour the minute.
 */
export function minuteLevel(polls: VoiceMinute['polls']): NetworkLevel | null {
  const all = polls.good + polls.unstable + polls.bad;
  if (all === 0) return null;
  if (polls.bad >= 2) return 'bad';
  const notGood = polls.bad + polls.unstable;
  return notGood >= 2 && notGood * 3 >= all ? 'unstable' : 'good';
}

function heardOf(counts: HeardCounts, worst: WorstWindow | undefined): VoiceMinuteHeard | null {
  const concealedPct = concealedSpeechPct(counts);
  const gapsPerMin = gapsPerSpeechMin(counts);
  if (concealedPct === null || gapsPerMin === null) return null;
  return {
    concealedPct,
    gapsPerMin: Math.round(gapsPerMin),
    speechS: Math.round(speechSeconds(counts)),
    ...(worst ? { worstConcealedPct: worst.concealedPct, worstGaps: worst.gaps } : {})
  };
}

/** A minute's worst window as its row holds it; none before they were kept or with too little speech. */
const worstOf = (concealedPct: number | null, gaps: number): WorstWindow | undefined =>
  concealedPct === null ? undefined : { concealedPct, gaps };

const averageOf = (sum: number, polls: number) => (polls > 0 ? Math.round(sum / polls) : null);

// The column only ever holds these four (voice_session_samples_cpu_pressure_check).
function pressureOf(value: string | null): CpuPressure | null {
  return value === 'nominal' || value === 'fair' || value === 'serious' || value === 'critical' ? value : null;
}

// The column only ever holds these (voice_call_events_kind_check).
function stayEventKind(value: string): StayEventKind | null {
  return value === 'screen_on' ||
    value === 'screen_off' ||
    value === 'camera_on' ||
    value === 'camera_off' ||
    value === 'cpu_critical' ||
    value === 'relieved_ns'
    ? value
    : null;
}

/** A minute as the panel reads it, from its counts. A seat still held has them in memory, a finished one in its row. */
export function minuteOfSample(sample: VoiceMinuteSample): VoiceMinute {
  const { causes, polls, uplink, cpu } = sample;
  return {
    at: sample.at,
    level: minuteLevel(polls),
    polls,
    ...(causes && causes.heard_badly + causes.hears_badly + causes.delay > 0 ? { causes } : {}),
    heard: heardOf(sample.heard, sample.worstHeard),
    heardBy: heardOf(sample.heardBy, sample.worstHeardBy),
    uplinkLossPct: uplink.packets > 0 ? Math.round((uplink.lost / uplink.packets) * 1000) / 10 : null,
    rttMs: averageOf(sample.rttMsSum, sample.rttPolls),
    jitterBufferMs: averageOf(sample.jitterBufferMsSum, sample.jitterBufferPolls),
    transport: sample.transport,
    // Most clients say nothing of their computer, and a minute then carries nothing of it.
    ...(cpu && (cpu.polls > 0 || cpu.pressureMax || cpu.relieved)
      ? {
          cpuAppPct: averageOf(cpu.appPctSum, cpu.polls),
          cpuSystemPct: averageOf(cpu.systemPctSum, cpu.polls),
          cpuPressure: cpu.pressureMax,
          relieved: cpu.relieved
        }
      : {})
  };
}

// The column only ever holds these three (voice_session_samples_transport_check).
function voiceTransportOf(value: string | null): VoiceMinuteSample['transport'] {
  return value === 'udp' || value === 'tcp' || value === 'relay' ? value : null;
}

/** A temporary room has no name, so only a missing or deleted row means the room is gone. */
const roomNameOf = (row: { room_name: string | null; room_deleted_at: Date | string | null }) =>
  row.room_deleted_at === null ? row.room_name : null;

export type StaticRoomCounts = { all: number; active: number; trouble: number; quiet: number };

type StaticRoomSqlRow = AccountColumns & {
  room_id: string;
  name: string;
  room_avatar_key: string | null;
  created_at: Date;
  members: unknown;
  calls: unknown;
  minutes: unknown;
  last_at: Date | null;
  live: boolean;
  good: unknown;
  unstable: unknown;
  bad: unknown;
};

/** The end of the span of answers about a call that ended at `endedAt`. */
function feedbackUntil(endedAt: number, nextStartedAt: number | null): number {
  const latest = endedAt + FEEDBACK_AFTER_CALL_MS;
  return nextStartedAt === null ? latest : Math.min(latest, Math.max(nextStartedAt, endedAt + 1));
}

export function createAdminRoomsRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  /** The rooms by id, deleted ones too: a room can go while someone is still in its voice. */
  async function rooms(ids: readonly string[]): Promise<AdminRoomRow[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .selectFrom('rooms as r')
      .leftJoin('users as u', 'u.id', 'r.owner_id')
      .select([
        'r.id as room_id',
        'r.name',
        'r.is_static',
        'r.avatar_key as room_avatar_key',
        'u.id',
        'u.login',
        'u.display_name',
        'u.avatar_key',
        'u.avatar_color_key',
        'u.avatar_accent'
      ])
      .where('r.id', 'in', [...ids])
      .execute();
    return rows.map((row) => ({
      id: row.room_id,
      name: row.name,
      isStatic: row.is_static,
      avatarUrl: avatarUrl(row.room_avatar_key),
      owner: account(row)
    }));
  }

  async function accounts(ids: readonly string[]): Promise<RoomAccount[]> {
    if (ids.length === 0) return [];
    const rows = await db
      .selectFrom('users')
      .select(['id', 'login', 'display_name', 'avatar_key', 'avatar_color_key', 'avatar_accent'])
      .where('id', 'in', [...ids])
      .execute();
    return rows.map(account).filter((value): value is RoomAccount => value !== null);
  }

  /** Finished stays that still carry their room, with the room and the account behind each. */
  function stays() {
    return db
      .selectFrom('voice_sessions as s')
      .leftJoin('rooms as r', 'r.id', 's.room_id')
      .leftJoin('users as u', 'u.id', 's.user_id')
      .select([
        's.id as stay_id',
        's.room_id',
        's.joined_at',
        's.left_at',
        's.guest_name',
        's.guest_id',
        's.client',
        's.os',
        's.browser',
        's.ip_key',
        's.location',
        's.network',
        'r.name as room_name',
        'r.deleted_at as room_deleted_at',
        'r.is_static',
        'u.id',
        'u.login',
        'u.display_name',
        'u.avatar_key',
        'u.avatar_color_key',
        'u.avatar_accent'
      ])
      .where('s.room_id', 'is not', null)
      .where('s.room_id', '!=', '');
  }

  type StayRow = Awaited<ReturnType<ReturnType<typeof stays>['execute']>>[number];

  function toStay(row: StayRow): StoredStay {
    return {
      id: row.stay_id,
      roomId: row.room_id ?? '',
      roomName: roomNameOf(row),
      isStatic: row.is_static,
      account: account(row),
      guestName: row.guest_name,
      guestId: row.guest_id,
      client: clientOf(row.client),
      os: row.os,
      browser: row.browser,
      ipKey: row.ip_key,
      location: row.location,
      joinedAt: toMillis(row.joined_at),
      leftAt: toMillis(row.left_at),
      network: networkOf(row.network),
      minutes: []
    };
  }

  /** The stays with their voice minutes, read in one query. */
  async function withMinutes(list: StoredStay[]): Promise<StoredStay[]> {
    if (list.length === 0) return list;
    const rows = await db
      .selectFrom('voice_session_samples')
      .selectAll()
      .where(
        'stay_id',
        'in',
        list.map((stay) => stay.id)
      )
      .orderBy('stay_id')
      .orderBy('at')
      .execute();
    const byStay = new Map<string, VoiceMinute[]>();
    for (const row of rows) {
      const minute = minuteOfSample({
        at: toMillis(row.at),
        polls: { good: row.polls_good, unstable: row.polls_unstable, bad: row.polls_bad },
        causes: {
          heard_badly: row.polls_heard_badly,
          hears_badly: row.polls_hears_badly,
          delay: row.polls_delay
        },
        worstHeard: worstOf(row.heard_worst_concealed_pct, row.heard_worst_gaps),
        worstHeardBy: worstOf(row.heard_by_worst_concealed_pct, row.heard_by_worst_gaps),
        heard: {
          packets: row.heard_packets,
          lost: row.heard_lost,
          concealedSamples: row.heard_concealed,
          gaps: row.heard_gaps
        },
        heardBy: {
          packets: row.heard_by_packets,
          lost: row.heard_by_lost,
          concealedSamples: row.heard_by_concealed,
          gaps: row.heard_by_gaps
        },
        rttMsSum: row.rtt_ms_sum,
        rttPolls: row.rtt_polls,
        jitterBufferMsSum: row.jitter_buffer_ms_sum,
        jitterBufferPolls: row.jitter_buffer_polls,
        uplink: { packets: row.uplink_packets, lost: row.uplink_lost },
        mic: {
          expectedMs: row.mic_expected_ms,
          deliveredMs: row.mic_delivered_ms,
          contextMs: row.mic_context_ms,
          reopens: row.mic_reopens,
          replacements: row.mic_replacements
        },
        transport: voiceTransportOf(row.transport),
        cpu: {
          appPctSum: row.cpu_app_pct_sum,
          systemPctSum: row.cpu_system_pct_sum,
          polls: row.cpu_polls,
          pressureMax: pressureOf(row.cpu_pressure_max),
          relieved: row.cpu_relieved
        }
      });
      const minutes = byStay.get(row.stay_id) ?? [];
      minutes.push(minute);
      byStay.set(row.stay_id, minutes);
    }
    return list.map((stay) => ({ ...stay, minutes: byStay.get(stay.id) ?? [] }));
  }

  /**
   * Finished stays that still carry their room, the latest end first, a page
   * at a time: `after` is the end and id of the last stay already shown.
   */
  async function history(query: {
    roomId?: string | undefined;
    after?: HistoryAfter | undefined;
  }): Promise<{ stays: StoredStay[]; more: boolean }> {
    let select = stays();
    if (query.roomId) select = select.where('s.room_id', '=', query.roomId);
    const after = query.after;
    if (after) {
      const at = new Date(after.leftAt);
      select = select.where((eb) =>
        eb.or([eb('s.left_at', '<', at), eb.and([eb('s.left_at', '=', at), eb('s.id', '<', after.id)])])
      );
    }
    const rows = await select
      .orderBy('s.left_at', 'desc')
      .orderBy('s.id', 'desc')
      .limit(ROOM_HISTORY_PAGE_SIZE + 1)
      .execute();
    return {
      stays: await withMinutes(rows.slice(0, ROOM_HISTORY_PAGE_SIZE).map(toStay)),
      more: rows.length > ROOM_HISTORY_PAGE_SIZE
    };
  }

  /**
   * Finished stays gathered into calls, the latest end first, a page at a time.
   * Within a room, taken in the order people joined, a stay starts a new call
   * when it begins after every earlier stay has ended: the voice stood empty in
   * between. A call's id is its first stay's. `from`/`to` keep the calls that
   * overlap the span; `after` is the end and id of the last call already shown.
   */
  async function calls(query: {
    roomId?: string | undefined;
    accountId?: string | undefined;
    /** One call by its first stay's id. */
    callId?: string | undefined;
    after?: HistoryAfter | undefined;
    from?: number | undefined;
    to?: number | undefined;
  }): Promise<{ calls: StoredCall[]; more: boolean }> {
    // One call is told from its room's stays alone, not from every room's.
    const callRoom = query.callId
      ? (await db.selectFrom('voice_sessions').select('room_id').where('id', '=', query.callId).executeTakeFirst())
          ?.room_id
      : undefined;
    if (query.callId && !callRoom) return { calls: [], more: false };
    const roomId = query.roomId ?? callRoom ?? undefined;
    let pageQuery = db
      .with('ordered', (qb) => {
        let base = qb
          .selectFrom('voice_sessions')
          .select([
            'id',
            'room_id',
            'user_id',
            'joined_at',
            'left_at',
            sql<Date | null>`max(left_at) over (
              partition by room_id order by joined_at, id
              rows between unbounded preceding and 1 preceding
            )`.as('earlier_end')
          ])
          .where('room_id', 'is not', null)
          .where('room_id', '!=', '');
        if (roomId) base = base.where('room_id', '=', roomId);
        if (query.accountId) {
          const { accountId } = query;
          base = base.where('room_id', 'in', (eb) =>
            eb.selectFrom('voice_sessions').select('room_id').where('user_id', '=', accountId)
          );
        }
        return base;
      })
      .with('numbered', (qb) =>
        qb.selectFrom('ordered').select([
          'id',
          'room_id',
          'user_id',
          'joined_at',
          'left_at',
          sql<string>`sum(case when earlier_end is null or joined_at > earlier_end then 1 else 0 end) over (
              partition by room_id order by joined_at, id
            )`.as('call_no')
        ])
      )
      .with('gathered', (qb) =>
        qb
          .selectFrom('numbered')
          .select([
            'room_id',
            'call_no',
            sql<string>`(array_agg(id order by joined_at, id))[1]`.as('call_id'),
            sql<Date>`min(joined_at)`.as('started_at'),
            sql<Date>`max(left_at)`.as('ended_at'),
            sql<Date | null>`lead(min(joined_at)) over (partition by room_id order by min(joined_at))`.as(
              'next_started_at'
            ),
            sql<boolean>`coalesce(bool_or(user_id = ${query.accountId ?? null}), false)`.as('has_account')
          ])
          .groupBy(['room_id', 'call_no'])
      )
      .selectFrom('gathered as c')
      .leftJoin('rooms as r', 'r.id', 'c.room_id')
      .select([
        'c.call_id',
        'c.room_id',
        'c.started_at',
        'c.ended_at',
        'c.next_started_at',
        'r.name as room_name',
        'r.deleted_at as room_deleted_at',
        'r.is_static',
        'r.avatar_key as room_avatar_key'
      ]);
    if (query.accountId) pageQuery = pageQuery.where('c.has_account', '=', true);
    if (query.callId) pageQuery = pageQuery.where('c.call_id', '=', query.callId);
    if (query.from !== undefined) pageQuery = pageQuery.where('c.ended_at', '>', new Date(query.from));
    if (query.to !== undefined) pageQuery = pageQuery.where('c.started_at', '<', new Date(query.to));
    const after = query.after;
    if (after) {
      const at = new Date(after.leftAt);
      pageQuery = pageQuery.where((eb) =>
        eb.or([eb('c.ended_at', '<', at), eb.and([eb('c.ended_at', '=', at), eb('c.call_id', '<', after.id)])])
      );
    }
    const rows = await pageQuery
      .orderBy('c.ended_at', 'desc')
      .orderBy('c.call_id', 'desc')
      .limit(ROOM_CALLS_PAGE_SIZE + 1)
      .execute();
    const page = rows.slice(0, ROOM_CALLS_PAGE_SIZE).map((row) => ({
      id: row.call_id,
      roomId: row.room_id ?? '',
      roomName: roomNameOf(row),
      isStatic: row.is_static,
      avatarUrl: row.room_deleted_at === null ? avatarUrl(row.room_avatar_key) : null,
      startedAt: toMillis(row.started_at),
      endedAt: toMillis(row.ended_at),
      feedbackUntil: feedbackUntil(toMillis(row.ended_at), row.next_started_at ? toMillis(row.next_started_at) : null)
    }));
    if (page.length === 0) return { calls: [], more: false };

    const bad = await db
      .selectFrom('call_feedback')
      .select(['room_id', 'created_at'])
      .where('rating', '=', 'bad')
      .where((eb) =>
        eb.or(
          page.map((call) =>
            eb.and([
              eb('room_id', '=', call.roomId),
              eb('created_at', '>=', new Date(call.startedAt)),
              eb('created_at', '<', new Date(call.feedbackUntil))
            ])
          )
        )
      )
      .execute();
    const badFeedbackOf = (call: (typeof page)[number]) =>
      bad.filter((answer) => {
        const at = toMillis(answer.created_at);
        return answer.room_id === call.roomId && at >= call.startedAt && at < call.feedbackUntil;
      }).length;

    // A room's calls never overlap, so a call's stays are the room's stays inside its span.
    const members = await stays()
      .where((eb) =>
        eb.or(
          page.map((call) =>
            eb.and([
              eb('s.room_id', '=', call.roomId),
              eb('s.joined_at', '>=', new Date(call.startedAt)),
              eb('s.left_at', '<=', new Date(call.endedAt))
            ])
          )
        )
      )
      .orderBy('s.joined_at')
      .orderBy('s.id')
      .execute();
    const byCall = new Map<string, StoredStay[]>(page.map((call) => [call.id, []]));
    for (const stay of await withMinutes(members.map(toStay))) {
      const call = page.find(
        (candidate) =>
          candidate.roomId === stay.roomId && stay.joinedAt >= candidate.startedAt && stay.leftAt <= candidate.endedAt
      );
      if (call) byCall.get(call.id)?.push(stay);
    }
    return {
      calls: page.map((call) => ({
        ...call,
        stays: byCall.get(call.id) ?? [],
        badFeedback: badFeedbackOf(call)
      })),
      more: rows.length > ROOM_CALLS_PAGE_SIZE
    };
  }

  /** A room's finished stays since a moment, in the order people joined: the ones gone from a call still going on. */
  async function staysSince(roomId: string, since: number): Promise<StoredStay[]> {
    const rows = await stays()
      .where('s.room_id', '=', roomId)
      .where('s.left_at', '>=', new Date(since))
      .orderBy('s.joined_at')
      .orderBy('s.id')
      .execute();
    return withMinutes(rows.map(toStay));
  }

  /** What each stay's seat did, oldest first. */
  async function stayEvents(stayIds: readonly string[]): Promise<Map<string, StayEvent[]>> {
    const byStay = new Map<string, StayEvent[]>();
    if (stayIds.length === 0) return byStay;
    const rows = await db
      .selectFrom('voice_call_events')
      .select(['stay_id', 'at', 'kind'])
      .where('stay_id', 'in', [...stayIds])
      .orderBy('at')
      .execute();
    for (const row of rows) {
      const kind = stayEventKind(row.kind);
      if (!kind) continue;
      const events = byStay.get(row.stay_id) ?? [];
      events.push({ at: toMillis(row.at), kind });
      byStay.set(row.stay_id, events);
    }
    return byStay;
  }

  /** The persistent rooms with their numbers of the last 30 days, a page at a time, and how many each filter holds. */
  async function staticRooms(
    query: StaticRoomsListQuery
  ): Promise<{ rooms: StaticRoomRow[]; total: number; counts: StaticRoomCounts }> {
    const pattern = `%${escapeLike(query.q)}%`;
    const search = query.q
      ? sql`(name ILIKE ${pattern} OR room_id ILIKE ${pattern} OR login ILIKE ${pattern})`
      : sql`true`;
    const listed = sql`
      WITH stays AS (
        SELECT id, room_id, joined_at, left_at,
          max(left_at) OVER (
            PARTITION BY room_id ORDER BY joined_at, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
          ) AS earlier_end
        FROM voice_sessions
        WHERE room_id IS NOT NULL AND room_id <> ''
          AND joined_at > now() - interval '${RECENT_STAYS_DAYS} days' AND left_at > now() - interval '30 days'
      ),
      usage AS (
        SELECT room_id,
          count(*) FILTER (WHERE earlier_end IS NULL OR joined_at > earlier_end) AS calls,
          sum(extract(epoch FROM left_at - joined_at)) / 60.0 AS minutes
        FROM stays GROUP BY room_id
      ),
      last_stay AS (
        SELECT room_id, max(left_at) AS last_at FROM voice_sessions WHERE room_id IS NOT NULL GROUP BY room_id
      ),
      quality AS (
        SELECT s.room_id, ${QUALITY_COLUMNS}
        FROM voice_session_samples m JOIN stays s ON s.id = m.stay_id
        WHERE m.at > now() - interval '30 days'
        GROUP BY s.room_id
      ),
      member_count AS (SELECT room_id, count(*) AS members FROM room_memberships GROUP BY room_id),
      listed AS (
        SELECT r.id AS room_id, r.name, r.avatar_key AS room_avatar_key, r.created_at,
          o.id, o.login, o.display_name, o.avatar_key, o.avatar_color_key, o.avatar_accent,
          coalesce(mc.members, 0) AS members,
          coalesce(u.calls, 0) AS calls,
          coalesce(u.minutes, 0) AS minutes,
          l.last_at,
          r.id = ANY(${query.liveIds}::text[]) AS live,
          coalesce(q.good, 0) AS good, coalesce(q.unstable, 0) AS unstable, coalesce(q.bad, 0) AS bad
        FROM rooms r
        LEFT JOIN users o ON o.id = r.owner_id
        LEFT JOIN usage u ON u.room_id = r.id
        LEFT JOIN last_stay l ON l.room_id = r.id
        LEFT JOIN quality q ON q.room_id = r.id
        LEFT JOIN member_count mc ON mc.room_id = r.id
        WHERE r.is_static AND r.deleted_at IS NULL
      )`;
    const active = sql`(live OR last_at > now() - interval '7 days')`;
    const quiet = sql`(NOT live AND (last_at IS NULL OR last_at <= now() - interval '30 days'))`;
    const trouble = sql`(bad > 0 AND bad * 100 >= ${TROUBLE_BAD_PCT} * (good + unstable + bad))`;
    const filters = { all: sql`true`, active, quiet, trouble };
    const order = query.order === 'asc' ? sql`ASC` : sql`DESC`;
    const sorts: Record<StaticRoomsSort, unknown> = {
      lastCall: sql`CASE WHEN live THEN now() ELSE last_at END`,
      voice: sql`minutes`,
      members: sql`members`,
      quality: sql`CASE WHEN good + unstable + bad > 0 THEN bad::float / (good + unstable + bad) END`,
      created: sql`created_at`
    };
    const [rows, counted] = await Promise.all([
      sql<StaticRoomSqlRow>`${listed}
        SELECT * FROM listed WHERE ${filters[query.filter]} AND ${search}
        ORDER BY ${sorts[query.sort]} ${order} NULLS LAST, room_id ASC
        LIMIT ${STATIC_ROOMS_PAGE_SIZE} OFFSET ${(query.page - 1) * STATIC_ROOMS_PAGE_SIZE}`.execute(db),
      sql<Record<keyof StaticRoomCounts | 'found', unknown>>`${listed}
        SELECT count(*) FILTER (WHERE ${filters[query.filter]} AND ${search}) AS found,
          count(*) AS "all",
          count(*) FILTER (WHERE ${active}) AS active,
          count(*) FILTER (WHERE ${trouble}) AS trouble,
          count(*) FILTER (WHERE ${quiet}) AS quiet
        FROM listed`.execute(db)
    ]);
    const count = counted.rows[0];
    return {
      rooms: rows.rows.map((row) => ({
        id: row.room_id,
        name: row.name,
        avatarUrl: avatarUrl(row.room_avatar_key),
        owner: account(row),
        members: Number(row.members) || 0,
        createdAt: toMillis(row.created_at),
        calls30d: Number(row.calls) || 0,
        voiceMinutes30d: Math.round(Number(row.minutes) || 0),
        lastCallAt: row.last_at ? toMillis(row.last_at) : null,
        live: row.live,
        quality30d: qualityOf(row)
      })),
      total: Number(count?.found) || 0,
      counts: {
        all: Number(count?.all) || 0,
        active: Number(count?.active) || 0,
        trouble: Number(count?.trouble) || 0,
        quiet: Number(count?.quiet) || 0
      }
    };
  }

  /**
   * For each ask, the account's (or guest browser's) stay in the room that the
   * answer is about: the latest one that ended by `at`, else the first that
   * ended in the few minutes after; none older than a day. Null when none is
   * kept. One indexed probe per ask, then the stays themselves.
   */
  async function lastStays(asks: readonly StayAsk[]): Promise<(StoredStay | null)[]> {
    const findable = asks.flatMap((ask, n) => (ask.userId || ask.guestId ? [{ ...ask, n }] : []));
    if (findable.length === 0) return asks.map(() => null);
    const asked = sql.join(
      findable.map(
        (ask) =>
          sql`(${ask.n}::int, ${ask.roomId}::text, ${ask.userId}::text, ${ask.userId ? null : ask.guestId}::uuid,
            ${new Date(ask.at)}::timestamptz, ${new Date(ask.at - STAY_ENDS_BEFORE_MS)}::timestamptz,
            ${new Date(ask.at + STAY_ENDS_AFTER_MS)}::timestamptz)`
      )
    );
    const picked = await sql<{ n: number; stay_id: string }>`
      SELECT a.n, v.id AS stay_id
      FROM (VALUES ${asked}) AS a(n, room_id, user_id, guest_id, at, since, until)
      CROSS JOIN LATERAL (
        SELECT s.id
        FROM voice_sessions s
        WHERE s.room_id = a.room_id
          AND CASE WHEN a.user_id IS NOT NULL THEN s.user_id = a.user_id
                   ELSE s.user_id IS NULL AND s.guest_id = a.guest_id END
          AND s.joined_at <= a.until
          AND s.left_at BETWEEN a.since AND a.until
        ORDER BY s.left_at > a.at, abs(extract(epoch FROM s.left_at - a.at)), s.id
        LIMIT 1
      ) v
    `.execute(db);
    const ids = picked.rows.map((row) => row.stay_id);
    const rows = ids.length ? await stays().where('s.id', 'in', ids).execute() : [];
    const byId = new Map((await withMinutes(rows.map(toStay))).map((stay) => [stay.id, stay]));
    const byAsk = new Map(picked.rows.map((row) => [row.n, byId.get(row.stay_id) ?? null]));
    return asks.map((_ask, n) => byAsk.get(n) ?? null);
  }

  return Object.freeze({ rooms, accounts, history, calls, staysSince, stayEvents, staticRooms, lastStays });
}

export type AdminRoomsRepository = ReturnType<typeof createAdminRoomsRepository>;
