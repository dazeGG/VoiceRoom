// Marks accounts active for the day: on every signed-in request, and for every
// account with a socket still open (someone in voice through midnight makes
// no requests). A mark is written once per account, day and client kind; the
// rest are answered from memory, so a request never waits on it.

import type { Logger } from 'pino';
import { clientKind } from '@voice-room/shared/account-security';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import type { ActivityMark, ActivityRepository } from './activity.repository.ts';

// Days are counted in Moscow time, where the users are: a late evening call
// belongs to that evening, not to the next UTC day.
const DAY_OFFSET_MS = 3 * 60 * 60 * 1000;

export function activityDay(at: number): string {
  return new Date(at + DAY_OFFSET_MS).toISOString().slice(0, 10);
}

export interface ActivityTrackerDeps {
  repository(): Pick<ActivityRepository, 'recordActivity'> | null;
  logger(): Pick<Logger, 'error'>;
  now?: () => number;
}

export function createActivityTracker(deps: ActivityTrackerDeps) {
  const now = deps.now ?? Date.now;
  let day = '';
  // Today's written marks, as "user|client", and the accounts among them.
  const recorded = new Set<string>();
  const activeToday = new Set<string>();

  function record(marks: ActivityMark[]): void {
    const repository = deps.repository();
    if (!repository) return;
    const fresh = marks.filter((mark) => !recorded.has(`${mark.userId}|${mark.client}`));
    if (fresh.length === 0) return;
    for (const mark of fresh) {
      recorded.add(`${mark.userId}|${mark.client}`);
      activeToday.add(mark.userId);
    }
    repository.recordActivity(fresh).catch((error: unknown) => {
      // Forget them, so the next request or sweep tries again.
      if (fresh[0]?.day === day) {
        for (const mark of fresh) {
          recorded.delete(`${mark.userId}|${mark.client}`);
          activeToday.delete(mark.userId);
        }
      }
      deps
        .logger()
        .error(
          { evt: LOG_EVENTS.ACCOUNT_ACTIVITY_RECORD_FAILED, marks: fresh.length, err: error },
          'failed to record activity'
        );
    });
  }

  function today(): string {
    const current = activityDay(now());
    if (current !== day) {
      day = current;
      recorded.clear();
      activeToday.clear();
    }
    return day;
  }

  /** A signed-in request from this account, with the user agent it came with. */
  function sawRequest(userId: string, userAgent: string | null | undefined): void {
    if (!userId) return;
    record([{ userId, day: today(), client: clientKind(userAgent) }]);
  }

  /** Accounts with a socket open right now. */
  function sawConnected(userIds: Iterable<string, unknown, unknown>): void {
    const current = today();
    const marks: ActivityMark[] = [];
    for (const userId of new Set(userIds)) {
      if (userId && !activeToday.has(userId)) marks.push({ userId, day: current, client: null });
    }
    record(marks);
  }

  return { sawRequest, sawConnected };
}

export type ActivityTracker = ReturnType<typeof createActivityTracker>;
