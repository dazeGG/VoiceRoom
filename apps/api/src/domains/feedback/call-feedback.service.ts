// "How was the call?": storing an answer, from an account or a guest, and the
// platform administrator's read of the answers.

import {
  ADMIN_CALL_FEEDBACK_DEFAULT_DAYS,
  CALL_FEEDBACK_COMMENT_MAX_LENGTH,
  CALL_FEEDBACK_TAGS_BY_RATING,
  type AdminCallFeedbackPage,
  type AdminCallFeedbackQuery,
  type CallFeedbackBody,
  type CallFeedbackRating,
  type CallFeedbackTag
} from '@voice-room/shared/contracts/feedback';
import type { StaffCheck } from '../staff/staff-check.ts';
import type { CallFeedbackRepository } from './call-feedback.repository.ts';

export interface CallFeedbackServiceDeps {
  repository: () => Pick<CallFeedbackRepository, 'insert' | 'summarize' | 'listRecent'>;
  staff: StaffCheck;
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The tags that belong to the rating, each once, in the order given. */
function tagsOfRating(rating: CallFeedbackRating, tags: readonly CallFeedbackTag[]): CallFeedbackTag[] {
  const allowed = CALL_FEEDBACK_TAGS_BY_RATING[rating];
  return [...new Set(tags)].filter((tag) => allowed.includes(tag));
}

// PostgreSQL text refuses NUL, so control characters go (a comment keeps its
// line breaks); the length is counted in characters, as the column check does.
function cleanText(value: string, maxChars: number, keepLines: boolean): string {
  const kept = Array.from(value).filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (code >= 0x20 && code !== 0x7f) || (keepLines && char === '\n');
  });
  return Array.from(kept.join('').trim()).slice(0, maxChars).join('');
}

export function createCallFeedbackService(deps: CallFeedbackServiceDeps) {
  const now = deps.now ?? Date.now;

  async function submit(userId: string | null, body: CallFeedbackBody): Promise<void> {
    await deps.repository().insert({
      userId,
      rating: body.rating,
      tags: tagsOfRating(body.rating, body.tags),
      comment: cleanText(body.comment ?? '', CALL_FEEDBACK_COMMENT_MAX_LENGTH, true),
      call: { ...body.call, roomId: cleanText(body.call.roomId, 64, false) }
    });
  }

  /** Null when the actor may not see the numbers. */
  async function list(
    actorUserId: string,
    query: AdminCallFeedbackQuery
  ): Promise<Omit<AdminCallFeedbackPage, 'ok'> | null> {
    if (!(await deps.staff.can(actorUserId, 'stats.view'))) return null;
    const days = query.days ? Number(query.days) : ADMIN_CALL_FEEDBACK_DEFAULT_DAYS;
    const since = new Date(now() - days * DAY_MS);
    const repository = deps.repository();
    const [summary, entries] = await Promise.all([
      repository.summarize(since),
      repository.listRecent(since, query.rating ?? null)
    ]);
    return { days, summary, entries };
  }

  return Object.freeze({ submit, list });
}

export type CallFeedbackService = ReturnType<typeof createCallFeedbackService>;
