// Finished stays in a room's voice, kept for usage numbers. The only writer of
// voice_sessions (the account deletion purge aside).

import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';

export type FinishedVoiceSession = {
  roomId: string;
  /** The account, or null for a guest. */
  userId: string | null;
  joinedAt: number;
  leftAt: number;
};

export function createVoiceSessionRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  async function recordSessions(sessions: FinishedVoiceSession[]): Promise<void> {
    if (sessions.length === 0) return;
    await db
      .insertInto('voice_sessions')
      .values(
        sessions.map((session) => ({
          room_id: session.roomId,
          user_id: session.userId,
          joined_at: new Date(session.joinedAt),
          left_at: new Date(Math.max(session.leftAt, session.joinedAt))
        }))
      )
      .execute();
  }

  return Object.freeze({ recordSessions });
}

export type VoiceSessionRepository = ReturnType<typeof createVoiceSessionRepository>;
