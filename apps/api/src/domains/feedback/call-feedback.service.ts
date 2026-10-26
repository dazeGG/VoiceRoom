// "How was the call?": storing an answer, from an account or a guest, and the
// platform administrator's read of the answers, each beside the stay in voice
// it is about: who the guest was, from what device and where, and how the
// network went.

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
import type { RoomStay } from '@voice-room/shared/contracts/admin';
import { normalizeGuestId } from '@voice-room/shared/validation';
import type { StaffCheck } from '../staff/staff-check.ts';
import type { StayAsk } from '../admin/admin-rooms.repository.ts';
import type { CallFeedbackRepository } from './call-feedback.repository.ts';

export interface CallFeedbackServiceDeps {
  repository: () => Pick<CallFeedbackRepository, 'insert' | 'summarize' | 'listRecent'>;
  staff: StaffCheck;
  /** Each answer's stay, in the order asked (admin-rooms.repository lastStays). */
  stays(asks: readonly StayAsk[]): Promise<(RoomStay | null)[]>;
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
    const { guestId, ...call } = body.call;
    await deps.repository().insert({
      userId,
      guestId: userId ? null : normalizeGuestId(guestId) || null,
      rating: body.rating,
      tags: tagsOfRating(body.rating, body.tags),
      comment: cleanText(body.comment ?? '', CALL_FEEDBACK_COMMENT_MAX_LENGTH, true),
      call: { ...call, roomId: cleanText(call.roomId, 64, false) }
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
    const [summary, answers, rooms, origin] = await Promise.all([
      repository.summarize(since),
      repository.listRecent(since, query.rating ?? null),
      deps.staff.can(actorUserId, 'rooms.view'),
      deps.staff.can(actorUserId, 'origin.view')
    ]);
    // Who was in which room is the rooms section's to tell, where from its origin's.
    const stays = !rooms
      ? answers.map(() => null)
      : await deps.stays(
          answers.map((answer) => ({
            roomId: answer.roomId,
            userId: answer.userId,
            guestId: answer.guestId,
            at: answer.createdAt
          }))
        );
    const entries = answers.map(({ userId: _userId, guestId: _guestId, ...answer }, index) => {
      const stay = stays[index] ?? null;
      // Where a stay came from is for those who may see it, as in the rooms section.
      return { ...answer, stay: stay && !origin ? { ...stay, guestId: null, ipKey: null, location: null } : stay };
    });
    return { days, summary, entries };
  }

  return Object.freeze({ submit, list });
}

export type CallFeedbackService = ReturnType<typeof createCallFeedbackService>;
