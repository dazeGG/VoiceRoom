// Finished stays in a room's voice, kept for usage numbers and, while they
// still carry their room, the admin panel's room history. The only writer of
// voice_sessions (the account deletion purge aside).
//
// A stay says who and where from without an IP address or a city: the address
// only yields its keyed hash (see DescribeAddress), which tells addresses apart
// for bans and quotas; the city is shown for people in voice now, never kept.

import { sql } from 'kysely';
import type pg from 'pg';
import type { ClientKind } from '@voice-room/shared/contracts/admin';
import type { NetworkPoint } from '@voice-room/shared/contracts/rooms';
import { kyselyOn } from '../../platform/db/kysely.ts';

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
  /** The changes of its network level the client reported; none when it never did. */
  network?: readonly NetworkPoint[];
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
    await db
      .insertInto('voice_sessions')
      .values(
        sessions.map((session, index) => ({
          room_id: session.roomId,
          user_id: session.userId,
          guest_name: session.userId ? null : session.guestName,
          guest_id: (!session.userId && session.guestId) || null,
          client: session.client,
          os: session.os || null,
          browser: session.browser || null,
          ip_key: origins[index]?.ipKey ?? null,
          joined_at: new Date(session.joinedAt),
          left_at: new Date(Math.max(session.leftAt, session.joinedAt)),
          network: session.network?.length ? JSON.stringify(session.network) : null
        }))
      )
      .execute();
  }

  /**
   * Clears the room of every stay that began before the cutoff (the indexed end),
   * and with it whose and where from it was; answers how many.
   */
  async function forgetRoomsBefore(cutoff: Date): Promise<number> {
    const result = await db
      .updateTable('voice_sessions')
      .set({ room_id: null, guest_name: null, guest_id: null, ip_key: null, location: null, network: null })
      .where('room_id', 'is not', null)
      .where('joined_at', '<', cutoff)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
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
