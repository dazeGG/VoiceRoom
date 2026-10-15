// The admin panel's use cases: whether an account is a platform
// administrator, and for one, the product and server numbers over the span it
// asks for. A non-admin gets null from every read, which the route answers
// with 403.

import {
  MAX_PRODUCT_DAYS,
  SYSTEM_KEEP_DAYS,
  type AdminOverview,
  type LiveNumbers,
  type ProductQuery,
  type ProductStats,
  type SystemQuery,
  type SystemStats
} from '@voice-room/shared/contracts/admin';
import type { AdminStatsRepository } from './admin-stats.repository.ts';
import type { SystemSnapshotRepository } from '../ops/system-snapshot.repository.ts';
import { isPlatformAdmin } from './admin.policy.ts';

/** Activity days, voice stays and peaks are recorded from this Moscow day on (release 2.8.8). */
export const TRACKING_SINCE = '2026-10-15';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PRODUCT_DAYS = 30;
const RETENTION_WEEKS = 12;
const DEFAULT_SYSTEM_MS = DAY_MS;
const MIN_SYSTEM_MS = 5 * 60 * 1000;
/** About this many points on a server chart, whatever the span. */
const SYSTEM_POINTS = 360;
const BUCKET_SECONDS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

const moscowDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** The Moscow day of a moment, 'YYYY-MM-DD'. */
export function moscowDay(at: number): string {
  return moscowDate.format(at);
}

function dayNumber(day: string | undefined): number | null {
  if (!day) return null;
  const time = Date.parse(`${day}T00:00:00Z`);
  // 2026-02-31 parses to March; only a day that reads back the same is real.
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? time / DAY_MS : null;
}

const dayString = (number: number) => new Date(number * DAY_MS).toISOString().slice(0, 10);

/**
 * The days a product request covers: both ends included, never past today,
 * reversed ends swapped, at most MAX_PRODUCT_DAYS, and starting no earlier
 * than the first account (or ending on it when the whole span is before it).
 */
export function productSpan(query: ProductQuery, today: string, firstDay: string | null): { from: string; to: string } {
  const last = dayNumber(today)!;
  let to = dayNumber(query.to) ?? last;
  let from = dayNumber(query.from) ?? Math.min(to, last) - (DEFAULT_PRODUCT_DAYS - 1);
  if (from > to) [from, to] = [to, from];
  to = Math.min(to, last);
  from = Math.min(from, to);
  from = Math.max(from, to - (MAX_PRODUCT_DAYS - 1));
  const first = dayNumber(firstDay ?? undefined);
  if (first !== null && from < first) from = Math.min(first, to);
  return { from: dayString(from), to: dayString(to) };
}

/**
 * The moments a server request covers: never past now nor before the kept
 * minutes, reversed ends swapped, at least five minutes, in buckets that give
 * about SYSTEM_POINTS points.
 */
export function systemSpan(query: SystemQuery, now: number): { from: number; to: number; bucketSeconds: number } {
  const parse = (value: string | undefined) => (value === undefined ? null : Number(value));
  let to = parse(query.to) ?? now;
  let from = parse(query.from) ?? Math.min(to, now) - DEFAULT_SYSTEM_MS;
  if (from > to) [from, to] = [to, from];
  to = Math.min(to, now);
  from = Math.min(from, to);
  const kept = now - SYSTEM_KEEP_DAYS * DAY_MS;
  from = Math.max(from, kept);
  to = Math.max(to, from);
  if (to - from < MIN_SYSTEM_MS) from = to - MIN_SYSTEM_MS;
  const seconds = (to - from) / 1000;
  const bucketSeconds =
    BUCKET_SECONDS.find((bucket) => seconds / bucket <= SYSTEM_POINTS) ?? BUCKET_SECONDS[BUCKET_SECONDS.length - 1]!;
  return { from, to, bucketSeconds };
}

type Payload<T> = Omit<T, 'ok'>;

export interface AdminServiceDeps {
  adminUserIds: readonly string[];
  stats(): Pick<AdminStatsRepository, 'overview' | 'productDays' | 'retention' | 'openReports' | 'firstAccountDay'>;
  systemSnapshots(): Pick<SystemSnapshotRepository, 'latest' | 'buckets'>;
  live(): LiveNumbers;
  livekitEnabled(): boolean;
  version: string;
  startedAt: number;
  now?: () => number;
}

export function createAdminService(deps: AdminServiceDeps) {
  const now = deps.now ?? Date.now;
  const admin = (userId: string) => isPlatformAdmin(deps.adminUserIds, userId);

  async function access(userId: string): Promise<{ admin: boolean; openReports: number }> {
    if (!admin(userId)) return { admin: false, openReports: 0 };
    return { admin: true, openReports: await deps.stats().openReports() };
  }

  async function overview(userId: string): Promise<Payload<AdminOverview> | null> {
    if (!admin(userId)) return null;
    const [counts, system] = await Promise.all([deps.stats().overview(), deps.systemSnapshots().latest()]);
    return {
      live: deps.live(),
      today: {
        day: counts.day,
        activeAccounts: counts.activeToday,
        newAccounts: counts.newToday,
        messages: counts.messagesToday,
        voiceJoins: counts.voiceJoinsToday,
        voiceMinutes: counts.voiceMinutesToday
      },
      totals: {
        accounts: counts.accounts,
        staticRooms: counts.staticRooms,
        temporaryRooms: counts.temporaryRooms,
        messages: counts.messages,
        weeklyActive: counts.weeklyActive,
        monthlyActive: counts.monthlyActive
      },
      openReports: counts.openReports,
      livekit: deps.livekitEnabled(),
      version: deps.version,
      startedAt: deps.startedAt,
      system
    };
  }

  async function product(userId: string, query: ProductQuery = {}): Promise<Payload<ProductStats> | null> {
    if (!admin(userId)) return null;
    const stats = deps.stats();
    const { from, to } = productSpan(query, moscowDay(now()), await stats.firstAccountDay());
    const [{ days, accountsBefore }, retention] = await Promise.all([
      stats.productDays(from, to),
      stats.retention(RETENTION_WEEKS)
    ]);
    return { from, to, days, accountsBefore, retention, trackingSince: TRACKING_SINCE };
  }

  async function system(userId: string, query: SystemQuery = {}): Promise<Payload<SystemStats> | null> {
    if (!admin(userId)) return null;
    const { from, to, bucketSeconds } = systemSpan(query, now());
    const samples = await deps.systemSnapshots().buckets(new Date(from), new Date(to), bucketSeconds);
    return { from, to, bucketSeconds, samples };
  }

  return Object.freeze({ isAdmin: admin, access, overview, product, system });
}

export type AdminService = ReturnType<typeof createAdminService>;
