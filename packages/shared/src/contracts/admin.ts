// /api/admin/*: the platform administrator's panel. Any signed-in account may
// ask whether it is an administrator (the app shows the entry only then); the
// numbers themselves answer an administrator only. Days are Moscow days
// ('YYYY-MM-DD'), as the activity marks are.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';

/** Whether the panel is this account's, and for an administrator how many reports wait. */
export const AdminAccess = Ok({ admin: Type.Boolean(), openReports: Type.Number() });

/** What the realtime layer tells administrators when the open reports change. */
export interface AdminReportsEvent {
  openReports: number;
  /** Set when the change is a new report. */
  filed: null | {
    reason: 'spam' | 'abuse' | 'illegal' | 'other';
    targetKind: 'room_message' | 'direct_message';
    roomName: string | null;
  };
}
export type AdminAccess = Static<typeof AdminAccess>;

/** The numbers the running API holds in memory right now. */
export const LiveNumbers = Type.Object({
  onlineAccounts: Type.Number(),
  guestConnections: Type.Number(),
  voicePeers: Type.Number(),
  voiceRooms: Type.Number()
});
export type LiveNumbers = Static<typeof LiveNumbers>;

/** One minute of the server, as the API saw it. Bytes are bytes; null is "not measured". */
export const SystemSample = Type.Object({
  at: Type.Number(),
  cpuPct: Nullable(Type.Number()),
  load1: Type.Number(),
  memUsedBytes: Type.Number(),
  memTotalBytes: Type.Number(),
  diskUsedBytes: Nullable(Type.Number()),
  diskTotalBytes: Nullable(Type.Number()),
  dbBytes: Nullable(Type.Number()),
  apiRssBytes: Type.Number(),
  eventLoopP99Ms: Type.Number(),
  wsConnections: Type.Number(),
  guestConnections: Type.Number(),
  voicePeers: Type.Number(),
  voiceRooms: Type.Number(),
  httpRequests: Type.Number(),
  http5xx: Type.Number(),
  httpAvgMs: Nullable(Type.Number())
});
export type SystemSample = Static<typeof SystemSample>;

export const AdminOverview = Ok({
  live: LiveNumbers,
  today: Type.Object({
    day: Type.String(),
    activeAccounts: Type.Number(),
    newAccounts: Type.Number(),
    messages: Type.Number(),
    voiceJoins: Type.Number(),
    voiceMinutes: Type.Number()
  }),
  totals: Type.Object({
    accounts: Type.Number(),
    staticRooms: Type.Number(),
    temporaryRooms: Type.Number(),
    messages: Type.Number(),
    weeklyActive: Type.Number(),
    monthlyActive: Type.Number()
  }),
  openReports: Type.Number(),
  livekit: Type.Boolean(),
  version: Type.String(),
  startedAt: Type.Number(),
  system: Nullable(SystemSample)
});
export type AdminOverview = Static<typeof AdminOverview>;

/** A Moscow day, 'YYYY-MM-DD'. */
export const DayString = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

/** The longest span of days one answer covers. */
export const MAX_PRODUCT_DAYS = 1100;

/**
 * The days to show, both included; without them the last 30 days. The server
 * keeps the span within MAX_PRODUCT_DAYS and starts it no earlier than the first account.
 */
export const ProductQuery = Type.Object({ from: Type.Optional(DayString), to: Type.Optional(DayString) });
export type ProductQuery = Static<typeof ProductQuery>;

/** One Moscow day of the product. Voice is counted on the day a stay began. */
export const ProductDay = Type.Object({
  day: Type.String(),
  activeAccounts: Type.Number(),
  desktopApp: Type.Number(),
  browser: Type.Number(),
  mobile: Type.Number(),
  newAccounts: Type.Number(),
  roomMessages: Type.Number(),
  directMessages: Type.Number(),
  messageAuthors: Type.Number(),
  staticRoomsCreated: Type.Number(),
  temporaryRoomsCreated: Type.Number(),
  voiceAccountHours: Type.Number(),
  voiceGuestHours: Type.Number(),
  voiceJoins: Type.Number(),
  voiceAccounts: Type.Number(),
  peakOnline: Type.Number(),
  peakGuests: Type.Number(),
  peakVoicePeers: Type.Number(),
  peakVoiceRooms: Type.Number()
});
export type ProductDay = Static<typeof ProductDay>;

/** The accounts registered in one week, and the share of them that came back. */
export const RetentionWeek = Type.Object({
  week: Type.String(),
  accounts: Type.Number(),
  returnedWeek1Pct: Type.Number(),
  returnedWeek2Pct: Type.Number(),
  returnedMonth1Pct: Type.Number()
});
export type RetentionWeek = Static<typeof RetentionWeek>;

export const ProductStats = Ok({
  /** The days the answer covers, after the server clamped the request. */
  from: Type.String(),
  to: Type.String(),
  /** Every day of the range, oldest first, zeros included. */
  days: Type.Array(ProductDay),
  /** Accounts before the range began, so a running total can start from it. */
  accountsBefore: Type.Number(),
  retention: Type.Array(RetentionWeek),
  /** The day activity, voice and peaks began to be recorded. */
  trackingSince: Type.String()
});
export type ProductStats = Static<typeof ProductStats>;

/** Milliseconds since the epoch, as a query string carries them. */
export const MillisString = Type.String({ pattern: '^\\d{1,15}$' });

/** How long the server keeps its minutes. */
export const SYSTEM_KEEP_DAYS = 30;

/** The span to show, in milliseconds; without it the last 24 hours. */
export const SystemQuery = Type.Object({ from: Type.Optional(MillisString), to: Type.Optional(MillisString) });
export type SystemQuery = Static<typeof SystemQuery>;

/**
 * The minutes of the range folded into buckets: gauges are the bucket's
 * highest value (a spike must not average away), request counts are summed.
 */
export const SystemStats = Ok({
  from: Type.Number(),
  to: Type.Number(),
  bucketSeconds: Type.Number(),
  samples: Type.Array(SystemSample)
});
export type SystemStats = Static<typeof SystemStats>;
