// The numbers the overview, product and system sections are shown in tests.

import type {
  AdminOverview,
  ProductDay,
  ProductStats,
  SystemSample,
  SystemStats
} from '@voice-room/shared/contracts/admin';

export const GB = 1024 ** 3;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** The value, or a failed test saying what was missing. */
export function must<Value>(value: Value | null | undefined, what: string): Value {
  if (value === null || value === undefined) throw new Error(`missing: ${what}`);
  return value;
}

export const sample = (at: number, overrides: Partial<SystemSample> = {}): SystemSample => ({
  at,
  cpuPct: 12.5,
  load1: 0.4,
  memUsedBytes: 1.5 * GB,
  memTotalBytes: 4 * GB,
  diskUsedBytes: 20 * GB,
  diskTotalBytes: 80 * GB,
  dbBytes: 64 * 1024 ** 2,
  apiRssBytes: 90 * 1024 ** 2,
  eventLoopP99Ms: 4,
  wsConnections: 7,
  guestConnections: 2,
  voicePeers: 3,
  voiceRooms: 1,
  httpRequests: 120,
  http5xx: 1,
  httpAvgMs: 18,
  ...overrides
});

export const overview: AdminOverview = {
  ok: true,
  live: { onlineAccounts: 5, guestConnections: 2, voicePeers: 3, voiceRooms: 1 },
  today: { day: '2026-10-16', activeAccounts: 4, newAccounts: 1, messages: 37, voiceJoins: 6, voiceMinutes: 95 },
  totals: { accounts: 24, staticRooms: 6, temporaryRooms: 30, messages: 432, weeklyActive: 9, monthlyActive: 15 },
  openReports: 2,
  livekit: true,
  version: '2.9.0',
  startedAt: Date.now() - 3 * HOUR,
  system: sample(Date.now() - 60_000, { diskUsedBytes: 75 * GB })
};

export const day = (date: string, overrides: Partial<ProductDay> = {}): ProductDay => ({
  day: date,
  activeAccounts: 0,
  desktopApp: 0,
  browser: 0,
  mobile: 0,
  newAccounts: 0,
  roomMessages: 0,
  directMessages: 0,
  messageAuthors: 0,
  staticRoomsCreated: 0,
  temporaryRoomsCreated: 0,
  voiceAccountHours: 0,
  voiceGuestHours: 0,
  voiceJoins: 0,
  voiceAccounts: 0,
  peakOnline: 0,
  peakGuests: 0,
  peakVoicePeers: 0,
  peakVoiceRooms: 0,
  ...overrides
});

export const product: ProductStats = {
  ok: true,
  from: '2026-10-15',
  to: '2026-10-16',
  days: [
    day('2026-10-15', { activeAccounts: 3, newAccounts: 2, roomMessages: 30, voiceAccountHours: 2 }),
    day('2026-10-16', { activeAccounts: 4, newAccounts: 1, roomMessages: 30, directMessages: 7, voiceAccountHours: 2 })
  ],
  accountsBefore: 22,
  retention: [{ week: '2026-10-12', accounts: 3, returnedWeek1Pct: 67, returnedWeek2Pct: 0, returnedMonth1Pct: 0 }],
  trackingSince: '2026-10-15'
};

export const at = Date.parse('2026-10-16T10:00:00Z');

export const system: SystemStats = {
  ok: true,
  from: at - DAY,
  to: at,
  bucketSeconds: 300,
  samples: [sample(at - 300_000), sample(at)]
};

export const denied = {
  status: 403,
  body: { ok: false, error: 'Platform administrator access required', code: 'platform_admin_required' }
};
