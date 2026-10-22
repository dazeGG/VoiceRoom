// Answers to "how was the call?". The only writer of call_feedback, apart
// from the account deletion that forgets whose answers they were.

import { sql } from 'kysely';
import type pg from 'pg';
import { Value } from 'typebox/value';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { epochMillis } from '../../platform/epoch-millis.ts';
import {
  ADMIN_CALL_FEEDBACK_LIMIT,
  CALL_FEEDBACK_PLATFORMS,
  CALL_FEEDBACK_RATINGS,
  CALL_FEEDBACK_TAGS,
  CallFeedbackQuality,
  type AdminCallFeedbackEntry,
  type AdminCallFeedbackPage,
  type CallFeedbackCall,
  type CallFeedbackPlatform,
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

// The table's CHECK constraints keep these columns to the contract's values;
// the guards only tell the compiler so.
const RATINGS: ReadonlySet<string> = new Set(CALL_FEEDBACK_RATINGS);
const TAGS: ReadonlySet<string> = new Set(CALL_FEEDBACK_TAGS);
const PLATFORMS: ReadonlySet<string> = new Set(CALL_FEEDBACK_PLATFORMS);
const isRating = (value: string): value is CallFeedbackRating => RATINGS.has(value);
const isTag = (value: string): value is CallFeedbackTag => TAGS.has(value);
const isPlatform = (value: string): value is CallFeedbackPlatform => PLATFORMS.has(value);

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
      tags: tags.rows.flatMap((row) => (isTag(row.tag) ? [{ tag: row.tag, count: Number(row.count) }] : []))
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
    return rows.flatMap((row) => {
      const { platform, quality } = row;
      const answer = row.rating;
      if (!isRating(answer) || !isPlatform(platform)) return [];
      return [
        {
          id: row.id,
          rating: answer,
          tags: row.tags.filter(isTag),
          comment: row.comment,
          createdAt: epochMillis(row.created_at) ?? 0,
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
          platform,
          quality: Value.Check(CallFeedbackQuality, quality) ? quality : null
        }
      ];
    });
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
