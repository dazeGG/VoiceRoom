// Answers to "how was the call?". The only writer of call_feedback, apart
// from the account deletion that forgets whose answers they were.

import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';
import {
  ADMIN_CALL_FEEDBACK_LIMIT,
  type AdminCallFeedbackEntry,
  type AdminCallFeedbackPage,
  type CallFeedbackCall,
  type CallFeedbackPlatform,
  type CallFeedbackQuality,
  type CallFeedbackRating,
  type CallFeedbackTag
} from '@voice-room/shared/contracts/feedback';

export type NewCallFeedback = {
  userId: string | null;
  rating: CallFeedbackRating;
  tags: CallFeedbackTag[];
  comment: string;
  call: CallFeedbackCall;
};

function toMillis(value: Date | string): number {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function createCallFeedbackRepository({ pool }: { pool: pg.Pool }) {
  const db = kyselyOn(pool);

  async function insert(input: NewCallFeedback): Promise<void> {
    await db
      .insertInto('call_feedback')
      .values({
        user_id: input.userId,
        rating: input.rating,
        tags: input.tags,
        comment: input.comment,
        room_id: input.call.roomId,
        duration_s: input.call.durationS,
        peers: input.call.peers,
        platform: input.call.platform,
        quality: input.call.quality ? JSON.stringify(input.call.quality) : null
      })
      .execute();
  }

  /** The ratings and tags of every answer since `since`. */
  async function summarize(since: Date): Promise<AdminCallFeedbackPage['summary']> {
    const ratings = await db
      .selectFrom('call_feedback')
      .select(['rating', (eb) => eb.fn.countAll<string>().as('count')])
      .where('created_at', '>=', since)
      .groupBy('rating')
      .execute();
    const tags = await sql<{ tag: string; count: string }>`
      SELECT tag, count(*) AS count
      FROM call_feedback, unnest(call_feedback.tags) AS tag
      WHERE call_feedback.created_at >= ${since}
      GROUP BY tag
      ORDER BY count DESC, tag ASC
    `.execute(db);
    const count = (rating: CallFeedbackRating) => Number(ratings.find((row) => row.rating === rating)?.count ?? 0);
    return {
      good: count('good'),
      bad: count('bad'),
      tags: tags.rows.map((row) => ({ tag: row.tag as CallFeedbackTag, count: Number(row.count) }))
    };
  }

  /** The newest answers since `since`, with who gave them and the room as it stands now. */
  async function listRecent(since: Date, rating: CallFeedbackRating | null): Promise<AdminCallFeedbackEntry[]> {
    let query = db
      .selectFrom('call_feedback as f')
      .leftJoin('users as u', 'u.id', 'f.user_id')
      .leftJoin('rooms as r', (join) => join.onRef('r.id', '=', 'f.room_id').on('r.deleted_at', 'is', null))
      .select([
        'f.id',
        'f.rating',
        'f.tags',
        'f.comment',
        'f.created_at',
        'f.room_id',
        'f.duration_s',
        'f.peers',
        'f.platform',
        'f.quality',
        'u.id as author_id',
        'u.login as author_login',
        'u.display_name as author_display_name',
        'r.name as room_name'
      ])
      .where('f.created_at', '>=', since);
    if (rating) query = query.where('f.rating', '=', rating);
    const rows = await query
      .orderBy('f.created_at', 'desc')
      .orderBy('f.id', 'desc')
      .limit(ADMIN_CALL_FEEDBACK_LIMIT)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      rating: row.rating as CallFeedbackRating,
      tags: row.tags as CallFeedbackTag[],
      comment: row.comment,
      createdAt: toMillis(row.created_at),
      author:
        row.author_id && row.author_login
          ? {
              userId: row.author_id,
              login: row.author_login,
              displayName: row.author_display_name || row.author_login
            }
          : null,
      roomId: row.room_id,
      roomName: row.room_name ?? null,
      durationS: row.duration_s,
      peers: row.peers,
      platform: row.platform as CallFeedbackPlatform,
      quality: (row.quality as CallFeedbackQuality | null) ?? null
    }));
  }

  /** Answers older than `cutoff` stop saying whose they were; returns how many changed. */
  async function forgetAuthorsBefore(cutoff: Date): Promise<number> {
    const result = await db
      .updateTable('call_feedback')
      .set({ user_id: null })
      .where('user_id', 'is not', null)
      .where('created_at', '<', cutoff)
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  return Object.freeze({ insert, summarize, listRecent, forgetAuthorsBefore });
}

export type CallFeedbackRepository = ReturnType<typeof createCallFeedbackRepository>;
