// The admin panel's use cases: whether an account is a platform
// administrator, and for one, the product and server numbers. A non-admin gets
// null from every read, which the route answers with 403.

import type {
  AdminOverview,
  LiveNumbers,
  ProductRange,
  ProductStats,
  SystemRange,
  SystemStats
} from '@voice-room/shared/contracts/admin';
import type { AdminStatsRepository } from './admin-stats.repository.ts';
import type { SystemSnapshotRepository } from '../ops/system-snapshot.repository.ts';
import { isPlatformAdmin } from './admin.policy.ts';

/** Activity days, voice stays and peaks are recorded from this Moscow day on (release 2.8.8). */
export const TRACKING_SINCE = '2026-10-15';

const PRODUCT_DAYS: Record<ProductRange, number> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };
const RETENTION_WEEKS = 12;
const HOUR_MS = 60 * 60 * 1000;
const SYSTEM_SPANS: Record<SystemRange, { spanMs: number; bucketSeconds: number }> = {
  '6h': { spanMs: 6 * HOUR_MS, bucketSeconds: 60 },
  '24h': { spanMs: 24 * HOUR_MS, bucketSeconds: 5 * 60 },
  '7d': { spanMs: 7 * 24 * HOUR_MS, bucketSeconds: 30 * 60 },
  '30d': { spanMs: 30 * 24 * HOUR_MS, bucketSeconds: 2 * 60 * 60 }
};

type Payload<T> = Omit<T, 'ok'>;

export interface AdminServiceDeps {
  adminUserIds: readonly string[];
  stats(): Pick<AdminStatsRepository, 'overview' | 'productDays' | 'retention'>;
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

  async function product(userId: string, range: ProductRange = '30d'): Promise<Payload<ProductStats> | null> {
    if (!admin(userId)) return null;
    const stats = deps.stats();
    const [{ days, accountsBefore }, retention] = await Promise.all([
      stats.productDays(PRODUCT_DAYS[range]),
      stats.retention(RETENTION_WEEKS)
    ]);
    return { range, days, accountsBefore, retention, trackingSince: TRACKING_SINCE };
  }

  async function system(userId: string, range: SystemRange = '24h'): Promise<Payload<SystemStats> | null> {
    if (!admin(userId)) return null;
    const { spanMs, bucketSeconds } = SYSTEM_SPANS[range];
    const samples = await deps.systemSnapshots().buckets(new Date(now() - spanMs), bucketSeconds);
    return { range, bucketSeconds, samples };
  }

  return Object.freeze({ isAdmin: admin, overview, product, system });
}

export type AdminService = ReturnType<typeof createAdminService>;
