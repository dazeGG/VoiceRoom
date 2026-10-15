// /api/admin/*: the platform administrator's panel. Any signed-in account may
// ask whether it is an administrator (the app shows the entry only then); the
// numbers themselves answer an administrator only. Days are Moscow days
// ('YYYY-MM-DD'), as the activity marks are.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';

export const AdminAccess = Ok({ admin: Type.Boolean() });
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

export const PRODUCT_RANGES = ['7d', '30d', '90d', '365d'] as const;
export type ProductRange = (typeof PRODUCT_RANGES)[number];

export const ProductQuery = Type.Object({
  range: Type.Optional(Type.Union([Type.Literal('7d'), Type.Literal('30d'), Type.Literal('90d'), Type.Literal('365d')]))
});
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
  range: Type.String(),
  /** Every day of the range, oldest first, zeros included. */
  days: Type.Array(ProductDay),
  /** Accounts before the range began, so a running total can start from it. */
  accountsBefore: Type.Number(),
  retention: Type.Array(RetentionWeek),
  /** The day activity, voice and peaks began to be recorded. */
  trackingSince: Type.String()
});
export type ProductStats = Static<typeof ProductStats>;

export const SYSTEM_RANGES = ['6h', '24h', '7d', '30d'] as const;
export type SystemRange = (typeof SYSTEM_RANGES)[number];

export const SystemQuery = Type.Object({
  range: Type.Optional(Type.Union([Type.Literal('6h'), Type.Literal('24h'), Type.Literal('7d'), Type.Literal('30d')]))
});
export type SystemQuery = Static<typeof SystemQuery>;

/**
 * The minutes of the range folded into buckets: gauges are the bucket's
 * highest value (a spike must not average away), request counts are summed.
 */
export const SystemStats = Ok({
  range: Type.String(),
  bucketSeconds: Type.Number(),
  samples: Type.Array(SystemSample)
});
export type SystemStats = Static<typeof SystemStats>;
