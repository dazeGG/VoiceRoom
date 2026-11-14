// /api/admin/*: the platform administrator's panel. Any signed-in account may
// ask whether it is an administrator (the app shows the entry only then); the
// numbers themselves answer an administrator only. Days are Moscow days
// ('YYYY-MM-DD'), as the activity marks are.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';
import { ReportReasonSchema } from './reports.ts';
import { CpuPressure, NetworkLevel, NetworkPoint, VoiceCause } from './rooms.ts';
import { StaffRoleSchema } from './staff.ts';
import { AccountBadge } from './users.ts';

/** What the realtime layer tells administrators when the open reports change. */
export const AdminReportsEvent = Type.Object({
  openReports: Type.Number(),
  /** Set for a new message report; user-report changes use null for compatibility. */
  filed: Nullable(
    Type.Object({
      reason: ReportReasonSchema,
      targetKind: Type.Union([Type.Literal('room_message'), Type.Literal('direct_message')]),
      roomName: Nullable(Type.String())
    })
  )
});
export type AdminReportsEvent = Static<typeof AdminReportsEvent>;

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
  httpAvgMs: Nullable(Type.Number()),
  /**
   * The media server (LiveKit): bytes in and out in the busiest minute of the
   * point; packets, the lost ones each way and the ones sent again, summed
   * over it; its CPU share of the whole server and its memory at their highest.
   * Null where LiveKit's metrics were not read.
   */
  sfuBytesIn: Nullable(Type.Number()),
  sfuBytesOut: Nullable(Type.Number()),
  sfuPacketsIn: Nullable(Type.Number()),
  sfuLostIn: Nullable(Type.Number()),
  sfuPacketsOut: Nullable(Type.Number()),
  sfuLostOut: Nullable(Type.Number()),
  sfuRetransmitOut: Nullable(Type.Number()),
  sfuCpuPct: Nullable(Type.Number()),
  sfuRssBytes: Nullable(Type.Number()),
  /**
   * The server's video: screen shares and cameras running at once at most, the
   * most video the budget counted as sent to viewers (Mbit/s) against the
   * budget (lowest over the point; null while it is off), and the stream
   * starts it lowered or refused, summed. Counts only, no people or rooms.
   */
  videoScreensMax: Nullable(Type.Number()),
  videoCamerasMax: Nullable(Type.Number()),
  videoMbpsMax: Nullable(Type.Number()),
  videoBudgetMbps: Nullable(Type.Number()),
  mediaLowered: Nullable(Type.Number()),
  mediaRefused: Nullable(Type.Number())
});
export type SystemSample = Static<typeof SystemSample>;

/** Good and bad answers, and how often each tag came with them, the most frequent first. */
export const FeedbackTally = Type.Object({
  good: Type.Number(),
  bad: Type.Number(),
  tags: Type.Array(Type.Object({ tag: Type.String(), count: Type.Number() }))
});
export type FeedbackTally = Static<typeof FeedbackTally>;

export const AdminOverview = Ok({
  live: LiveNumbers,
  today: Type.Object({
    day: Type.String(),
    activeAccounts: Type.Number(),
    newAccounts: Type.Number(),
    messages: Type.Number(),
    voiceJoins: Type.Number(),
    voiceMinutes: Type.Number(),
    /** Calls that went on today and are over, and the same of yesterday. Optional for an API a release behind. */
    calls: Type.Optional(Type.Number()),
    callsYesterday: Type.Optional(Type.Number())
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
  /** What the open reports are: since when, and for what. Optional for an API a release behind. */
  reports: Type.Optional(Type.Object({ oldestAt: Nullable(Type.Number()), reasons: Type.Array(ReportReasonSchema) })),
  /** Answers to "how was the call?" over the last day and the last week. Optional for an API a release behind. */
  feedback: Type.Optional(Type.Object({ day: FeedbackTally, week: FeedbackTally })),
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

// --- accounts -----------------------------------------------------------------

/** Accounts on one page of the list. */
export const ACCOUNTS_PAGE_SIZE = 50;
/** The days of an account's own activity chart. */
export const ACCOUNT_DAYS = 90;
export const ADMIN_REASON_MAX_LENGTH = 300;

/**
 * Which accounts the list shows: everyone, online now, registered in the last
 * week, active in the last week, gone (not seen for two weeks), blocked,
 * waiting to be deleted, carrying a mark, or with a voice worse than the norm
 * (TROUBLE_BAD_PCT of the minutes of the last 30 days were bad).
 */
export const AccountsFilter = Type.Union([
  Type.Literal('all'),
  Type.Literal('online'),
  Type.Literal('new'),
  Type.Literal('active'),
  Type.Literal('gone'),
  Type.Literal('blocked'),
  Type.Literal('deleting'),
  Type.Literal('badged'),
  Type.Literal('trouble')
]);
export type AccountsFilter = Static<typeof AccountsFilter>;
/** Every filter, for counting what each holds. */
export const ACCOUNTS_FILTERS: readonly AccountsFilter[] = AccountsFilter.anyOf.map((option) => option.const);

export const AccountsSort = Type.Union([
  Type.Literal('created'),
  Type.Literal('lastSeen'),
  Type.Literal('activeDays'),
  Type.Literal('voice'),
  Type.Literal('messages'),
  Type.Literal('reports'),
  Type.Literal('name'),
  Type.Literal('quality')
]);
export type AccountsSort = Static<typeof AccountsSort>;

/** The share of bad minutes over 30 days from which a voice counts as worse than the norm. */
export const TROUBLE_BAD_PCT = 5;

/** A stretch of voice by the minutes of each level; minutes nothing is known of are not counted. */
export const VoiceQuality = Type.Object({
  good: Type.Number(),
  unstable: Type.Number(),
  bad: Type.Number()
});
export type VoiceQuality = Static<typeof VoiceQuality>;

/** Search by name, login or id; without a sort the newest come first. Pages count from 1. */
export const AccountsQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 100 })),
  filter: Type.Optional(AccountsFilter),
  sort: Type.Optional(AccountsSort),
  order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
  page: Type.Optional(Type.String({ pattern: '^[1-9][0-9]{0,5}$' }))
});
export type AccountsQuery = Static<typeof AccountsQuery>;

/** Waiting to be deleted wins over blocked: an administrator's deletion blocks too. */
export const AccountStatus = Type.Union([Type.Literal('active'), Type.Literal('blocked'), Type.Literal('deleting')]);
export type AccountStatus = Static<typeof AccountStatus>;

/** One account in the list. Voice is in minutes; messages count room and direct ones. */
export const AccountRow = Type.Object({
  id: Type.String(),
  login: Type.String(),
  displayName: Type.String(),
  avatarUrl: Nullable(Type.String()),
  avatarColorKey: Type.String(),
  avatarAccent: Nullable(Type.String()),
  createdAt: Type.Number(),
  /** The latest of registration, an active day and a session's last request. */
  lastSeenAt: Type.Number(),
  activeDays: Type.Number(),
  /** The kinds of client used in the last 30 days. */
  clients: Type.Object({ desktopApp: Type.Boolean(), browser: Type.Boolean(), mobile: Type.Boolean() }),
  voiceMinutes: Type.Number(),
  messages: Type.Number(),
  ownedRooms: Type.Number(),
  /** Reports filed against this account's messages, open or not. */
  reportsAgainst: Type.Number(),
  online: Type.Boolean(),
  admin: Type.Boolean(),
  badge: Nullable(AccountBadge),
  status: AccountStatus,
  /** The minutes in voice of the last 30 days by level; null without any. Optional for an API a release behind. */
  voiceQuality30d: Type.Optional(Nullable(VoiceQuality))
});
export type AccountRow = Static<typeof AccountRow>;

export const AccountsPage = Ok({
  accounts: Type.Array(AccountRow),
  total: Type.Number(),
  page: Type.Number(),
  pageSize: Type.Number(),
  /** How many accounts each filter holds, the search aside. Optional for an API a release behind. */
  counts: Type.Optional(Type.Record(Type.String(), Type.Number())),
  /** Accounts whose computer was overloaded in at least half of their calls of the last 30 days; 0 without data. */
  cpuOverloaded: Type.Optional(Type.Number())
});
export type AccountsPage = Static<typeof AccountsPage>;

export const AccountBlock = Type.Object({
  at: Type.Number(),
  /** Null: for good. */
  until: Nullable(Type.Number()),
  reason: Type.String()
});
export type AccountBlock = Static<typeof AccountBlock>;

export const AdminActionKind = Type.Union([
  Type.Literal('block'),
  Type.Literal('unblock'),
  Type.Literal('logout'),
  Type.Literal('delete'),
  Type.Literal('cancel_deletion'),
  Type.Literal('badge'),
  Type.Literal('staff_role')
]);
export type AdminActionKind = Static<typeof AdminActionKind>;

/** One entry of what administrators did to an account. */
export const AdminActionEntry = Type.Object({
  id: Type.String(),
  at: Type.Number(),
  action: AdminActionKind,
  reason: Type.String(),
  adminName: Type.String(),
  /** A block's end (null: for good); null for other actions. */
  until: Nullable(Type.Number()),
  /** The mark a badge action set (null: taken away). */
  badge: Nullable(AccountBadge),
  /** The role a staff_role action gave (null: taken away, or another action). */
  role: Nullable(StaffRoleSchema)
});
export type AdminActionEntry = Static<typeof AdminActionEntry>;

/** One Moscow day of an account. */
export const AccountDay = Type.Object({
  day: Type.String(),
  active: Type.Boolean(),
  messages: Type.Number(),
  voiceMinutes: Type.Number()
});
export type AccountDay = Static<typeof AccountDay>;

/** A signed-in device, without where it is. */
export const AccountDevice = Type.Object({
  client: Type.String(),
  os: Type.String(),
  createdAt: Type.Number(),
  lastSeenAt: Type.Number()
});
export type AccountDevice = Static<typeof AccountDevice>;

export const AccountDetail = Ok({
  account: AccountRow,
  block: Nullable(AccountBlock),
  deletion: Nullable(Type.Object({ scheduledFor: Type.Number(), byAdmin: Type.Boolean() })),
  /** The last ACCOUNT_DAYS Moscow days, oldest first. */
  days: Type.Array(AccountDay),
  ownedRooms: Type.Array(Type.Object({ id: Type.String(), name: Type.String(), members: Type.Number() })),
  memberOf: Type.Number(),
  devices: Type.Array(AccountDevice),
  reports: Type.Object({ against: Type.Number(), againstOpen: Type.Number(), filed: Type.Number() }),
  actions: Type.Array(AdminActionEntry),
  /** How the voice went over the last 30 days; null without a minute of it. Optional for an API a release behind. */
  voice30d: Type.Optional(
    Nullable(
      Type.Object({
        minutes: Type.Number(),
        quality: VoiceQuality,
        rttAvgMs: Nullable(Type.Number()),
        uplinkLossPct: Nullable(Type.Number()),
        jitterBufferAvgMs: Nullable(Type.Number()),
        /** Shares of the minutes, in percent. */
        transport: Type.Object({ udp: Type.Number(), tcp: Type.Number(), relay: Type.Number() })
      })
    )
  ),
  /** How the computer did in those calls; null until its client has reported any. */
  cpu30d: Type.Optional(
    Nullable(
      Type.Object({
        appAvgPct: Nullable(Type.Number()),
        systemAvgPct: Nullable(Type.Number()),
        calls: Type.Number(),
        criticalCalls: Type.Number(),
        relievedCalls: Type.Number()
      })
    )
  )
});
export type AccountDetail = Static<typeof AccountDetail>;

export const BlockDuration = Type.Union([
  Type.Literal('day'),
  Type.Literal('week'),
  Type.Literal('month'),
  Type.Literal('forever')
]);
export type BlockDuration = Static<typeof BlockDuration>;

const Reason = Type.String({ minLength: 1, maxLength: ADMIN_REASON_MAX_LENGTH });

/** The reason is shown to the account at sign-in. */
export const BlockBody = Type.Object({ duration: BlockDuration, reason: Reason });
export type BlockBody = Static<typeof BlockBody>;

/** The account's login typed again, so the wrong account is not deleted by a slip. */
export const DeleteAccountBody = Type.Object({ login: Type.String({ maxLength: 64 }), reason: Reason });
export type DeleteAccountBody = Static<typeof DeleteAccountBody>;

export const BadgeBody = Type.Object({ badge: Nullable(AccountBadge) });
export type BadgeBody = Static<typeof BadgeBody>;

// --- rooms --------------------------------------------------------------------

/**
 * How long a stay in voice keeps the room it was in. Past it the stay only
 * counts towards the usage numbers: who talked with whom is forgotten.
 */
export const VOICE_HISTORY_KEEP_DAYS = 90;
/** Stays on one page of a room history. */
export const ROOM_HISTORY_PAGE_SIZE = 30;

/** An account as the rooms section shows it: enough for a name, an avatar and a link to its card. */
export const RoomAccount = Type.Object({
  id: Type.String(),
  login: Type.String(),
  displayName: Type.String(),
  avatarUrl: Nullable(Type.String()),
  avatarColorKey: Type.String(),
  avatarAccent: Nullable(Type.String())
});
export type RoomAccount = Static<typeof RoomAccount>;

/** Which kind of client a user agent is: the desktop app, the Android app, a phone, or a browser on a computer. */
export const ClientKind = Type.Union([
  Type.Literal('desktop_app'),
  Type.Literal('mobile_app'),
  Type.Literal('mobile'),
  Type.Literal('browser')
]);
export type ClientKind = Static<typeof ClientKind>;

/**
 * Where someone came from, without their address: `ipKey` is a keyed hash of the
 * IP (the same address always gives the same key, and the key never gives the
 * address back), `location` the city and country of that address.
 */
const NetworkOrigin = {
  ipKey: Nullable(Type.String()),
  location: Nullable(Type.String())
};

/** The device a socket said it was, from its user agent; empty when it did not say. */
const DeviceInfo = {
  os: Type.String(),
  browser: Type.String()
};

/** Someone in a room's voice now: an account, or a guest known only by the name given to the room. */
export const LiveRoomPeer = Type.Object({
  peerId: Type.String(),
  name: Type.String(),
  /** Null for a guest. */
  account: Nullable(RoomAccount),
  avatarColorKey: Type.String(),
  joinedAt: Nullable(Type.Number()),
  // Whether someone's microphone or sound is off is theirs: the panel shows
  // what loads the server (screens, cameras) and the connection, not that.
  screen: Type.Boolean(),
  /** The camera is on. Optional: an API a release behind does not say. */
  camera: Type.Optional(Type.Boolean()),
  /** The desktop app, the Android app, a phone or a browser; null when the socket sent no user agent. */
  client: Nullable(ClientKind),
  ...DeviceInfo,
  /** The lasting id of a guest's browser; null for an account or a guest that sent none. */
  guestId: Nullable(Type.String()),
  /** Random browser/application installation id; absent on older APIs. */
  clientId: Type.Optional(Nullable(Type.String())),
  ...NetworkOrigin,
  /**
   * The server's verdict on the peer's voice, the one its own room screen
   * shows; null while nothing was heard from or by it. Optional, like the other
   * network fields: the admin app and the API ship in different images, so an
   * API a release behind sends none.
   */
  network: Type.Optional(Nullable(NetworkLevel)),
  /** Whose side the trouble is on; null while the voice is good or unknown. */
  cause: Type.Optional(Nullable(VoiceCause)),
  /** How hard its computer works now; null where the client cannot tell. */
  cpuPressure: Type.Optional(Nullable(CpuPressure)),
  /** The overload made its call switch to the lighter noise suppression. */
  relieved: Type.Optional(Type.Boolean())
});
export type LiveRoomPeer = Static<typeof LiveRoomPeer>;

/** A room with someone in its voice. */
export const LiveRoom = Type.Object({
  roomId: Type.String(),
  name: Type.String(),
  isStatic: Type.Boolean(),
  avatarUrl: Nullable(Type.String()),
  /** Null for a temporary room, which nobody owns. */
  owner: Nullable(RoomAccount),
  /** When the call began: the server's call clock, the one the room screen counts from. */
  since: Nullable(Type.Number()),
  peers: Type.Array(LiveRoomPeer)
});
export type LiveRoom = Static<typeof LiveRoom>;

/** The rooms with someone in voice right now, the fullest first. */
export const LiveRooms = Ok({ rooms: Type.Array(LiveRoom) });
export type LiveRooms = Static<typeof LiveRooms>;

/** Rooms on one page of the persistent rooms. */
export const STATIC_ROOMS_PAGE_SIZE = 50;

/** All, with a call in the last week, with a voice worse than the norm, or without a call for 30 days. */
export const StaticRoomsFilter = Type.Union([
  Type.Literal('all'),
  Type.Literal('active'),
  Type.Literal('trouble'),
  Type.Literal('quiet')
]);
export type StaticRoomsFilter = Static<typeof StaticRoomsFilter>;

export const StaticRoomsSort = Type.Union([
  Type.Literal('lastCall'),
  Type.Literal('voice'),
  Type.Literal('members'),
  Type.Literal('quality'),
  Type.Literal('created')
]);
export type StaticRoomsSort = Static<typeof StaticRoomsSort>;

/** Search by name, code or the owner's login. Pages count from 1. */
export const StaticRoomsQuery = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 100 })),
  filter: Type.Optional(StaticRoomsFilter),
  sort: Type.Optional(StaticRoomsSort),
  order: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
  page: Type.Optional(Type.String({ pattern: '^[1-9][0-9]{0,5}$' }))
});
export type StaticRoomsQuery = Static<typeof StaticRoomsQuery>;

/** A persistent room with its numbers of the last 30 days. */
export const StaticRoomRow = Type.Object({
  id: Type.String(),
  name: Type.String(),
  avatarUrl: Nullable(Type.String()),
  owner: Nullable(RoomAccount),
  members: Type.Number(),
  createdAt: Type.Number(),
  calls30d: Type.Number(),
  voiceMinutes30d: Type.Number(),
  /** When its last finished stay ended; null when the history keeps none. */
  lastCallAt: Nullable(Type.Number()),
  /** Someone is in its voice now. */
  live: Type.Boolean(),
  quality30d: Nullable(VoiceQuality)
});
export type StaticRoomRow = Static<typeof StaticRoomRow>;

export const StaticRooms = Ok({
  rooms: Type.Array(StaticRoomRow),
  total: Type.Number(),
  page: Type.Number(),
  pageSize: Type.Number(),
  counts: Type.Object({
    all: Type.Number(),
    active: Type.Number(),
    trouble: Type.Number(),
    quiet: Type.Number()
  })
});
export type StaticRooms = Static<typeof StaticRooms>;

/** Where a page of history continues: the end and id of the last stay shown. */
export const HistoryCursor = Type.String({ pattern: '^[0-9]{1,15}_[0-9a-f-]{36}$' });

/** Finished stays, the latest first, of one room or of all. */
export const RoomHistoryQuery = Type.Object({
  roomId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  after: Type.Optional(HistoryCursor)
});
export type RoomHistoryQuery = Static<typeof RoomHistoryQuery>;

/** What one side of a minute's voice sounded like; see voice-quality.ts. */
export const VoiceMinuteHeard = Type.Object({
  /** The share of the speech the receiver had to make up, in percent. */
  concealedPct: Type.Number(),
  /** Gaps per minute of speech. */
  gapsPerMin: Type.Number(),
  /** The seconds of speech behind them, to weigh this minute against others. Optional for an API a release behind. */
  speechS: Type.Optional(Type.Number()),
  /**
   * The worst 15 seconds of any one speaker among the windows ending in this
   * minute: the numbers above are summed over everyone, which waters down one
   * speaker's trouble. Absent when no window had enough speech, and for minutes
   * before they were kept.
   */
  worstConcealedPct: Type.Optional(Type.Number()),
  worstGaps: Type.Optional(Type.Integer())
});
export type VoiceMinuteHeard = Static<typeof VoiceMinuteHeard>;

/** How many of a minute's polls gave each cause of trouble. */
export const VoiceMinuteCauses = Type.Object({
  heard_badly: Type.Integer(),
  hears_badly: Type.Integer(),
  delay: Type.Integer()
});
export type VoiceMinuteCauses = Static<typeof VoiceMinuteCauses>;

/**
 * One minute of a stay's voice, from its stats polls. `level` is bad when two
 * of the peer's own polls were bad, unstable when at least two and a third of
 * them were not good (one trouble stays in the 15 second window for five polls,
 * so it alone does not colour a minute), good with any other polls, and null
 * when it sent none. `polls` tells how long a shorter trouble lasted. A minute
 * with no row had no polls.
 */
export const VoiceMinute = Type.Object({
  /** The minute's start. */
  at: Type.Number(),
  level: Nullable(NetworkLevel),
  polls: Type.Object({ good: Type.Integer(), unstable: Type.Integer(), bad: Type.Integer() }),
  /** Why its polls were not good; absent when all were, or for minutes before they were kept. */
  causes: Type.Optional(VoiceMinuteCauses),
  /** What the peer heard of the others, and they of it; null with too little speech to tell. */
  heard: Nullable(VoiceMinuteHeard),
  heardBy: Nullable(VoiceMinuteHeard),
  /** The share of its audio packets the server never got, in percent. */
  uplinkLossPct: Nullable(Type.Number()),
  rttMs: Nullable(Type.Number()),
  jitterBufferMs: Nullable(Type.Number()),
  transport: Nullable(Type.String()),
  /**
   * How its computer did over the minute: VoiceRoom's share and the system's on
   * average (the desktop app only), the highest pressure, and whether the
   * lighter noise suppression was on. Optional for an API a release behind.
   */
  cpuAppPct: Type.Optional(Nullable(Type.Number())),
  cpuSystemPct: Type.Optional(Nullable(Type.Number())),
  cpuPressure: Type.Optional(Nullable(CpuPressure)),
  relieved: Type.Optional(Type.Boolean())
});
export type VoiceMinute = Static<typeof VoiceMinute>;

/** One finished stay in a room's voice. */
export const RoomStay = Type.Object({
  id: Type.String(),
  roomId: Type.String(),
  /** Null when the room is gone: temporary rooms are removed once empty. Empty for an unnamed temporary room. */
  roomName: Nullable(Type.String()),
  isStatic: Nullable(Type.Boolean()),
  /** Null for a guest. */
  account: Nullable(RoomAccount),
  /** The name a guest gave; null for an account and for stays recorded before guests' names were kept. */
  guestName: Nullable(Type.String()),
  guestId: Nullable(Type.String()),
  /** Random browser/application installation id, independent of the account. */
  clientId: Type.Optional(Nullable(Type.String())),
  /**
   * The client, device and origin of the socket that held the seat. Null for stays
   * recorded before they were kept; the guest fields and the origin are cleared
   * together with the room after VOICE_HISTORY_KEEP_DAYS.
   */
  client: Nullable(ClientKind),
  os: Nullable(Type.String()),
  browser: Nullable(Type.String()),
  ...NetworkOrigin,
  joinedAt: Type.Number(),
  leftAt: Type.Number(),
  /** How the connection went: each change of its level, the first at or after joinedAt. Empty when the client never said. */
  network: Type.Optional(Type.Array(NetworkPoint)),
  /** The voice minute by minute, for stays since the server judged the room; empty for the ones before. */
  minutes: Type.Optional(Type.Array(VoiceMinute))
});
export type RoomStay = Static<typeof RoomStay>;

export const RoomHistory = Ok({
  stays: Type.Array(RoomStay),
  /** Null on the last page. */
  next: Nullable(HistoryCursor),
  keepDays: Type.Number()
});
export type RoomHistory = Static<typeof RoomHistory>;

/** Calls on one page of the call history. */
export const ROOM_CALLS_PAGE_SIZE = 20;

/**
 * Finished calls, the latest end first, of one room or of all; `from` and `to`
 * (milliseconds) keep the calls that overlap that span, as a day's timeline
 * asks. `after` is where the previous page stopped; `accountId` keeps the
 * calls that account was in.
 */
export const RoomCallsQuery = Type.Object({
  roomId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  accountId: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  clientId: Type.Optional(Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' })),
  ipKey: Type.Optional(Type.String({ pattern: '^[0-9a-f]{16}$' })),
  after: Type.Optional(HistoryCursor),
  from: Type.Optional(MillisString),
  to: Type.Optional(MillisString)
});
export type RoomCallsQuery = Static<typeof RoomCallsQuery>;

/**
 * One call: everyone in a room's voice from the first coming in until the
 * last left, with no moment the voice stood empty. Its id is its first stay's;
 * its stays come in the order people joined. A call someone is still in is
 * not history yet: it shows among the live rooms.
 */
export const RoomCall = Type.Object({
  id: Type.String(),
  roomId: Type.String(),
  /** As on a stay: null once the room is gone, empty for an unnamed temporary room. */
  roomName: Nullable(Type.String()),
  isStatic: Nullable(Type.Boolean()),
  /** The room's picture as it is now; null without one or once the room is gone. Optional for an API a release behind. */
  avatarUrl: Type.Optional(Nullable(Type.String())),
  startedAt: Type.Number(),
  endedAt: Type.Number(),
  stays: Type.Array(RoomStay),
  /** Bad answers to "how was the call?" given about it. Optional for an API a release behind. */
  badFeedback: Type.Optional(Type.Number())
});
export type RoomCall = Static<typeof RoomCall>;

/** What went on in a call besides who was in it. Join, leave and network are read from its stays, the rest is kept. */
export const CallEventKind = Type.Union([
  Type.Literal('join'),
  Type.Literal('leave'),
  Type.Literal('screen_on'),
  Type.Literal('screen_off'),
  Type.Literal('camera_on'),
  Type.Literal('camera_off'),
  Type.Literal('network'),
  Type.Literal('cpu_critical'),
  Type.Literal('relieved_ns')
]);
export type CallEventKind = Static<typeof CallEventKind>;

export const CallEvent = Type.Object({
  at: Type.Number(),
  kind: CallEventKind,
  /** Whose: the stay it happened in. */
  stayId: Nullable(Type.String()),
  /** For a network change, the level it went to. */
  detail: Type.Optional(Type.String())
});
export type CallEvent = Static<typeof CallEvent>;

/** A call's address: its first stay's id, which the room's own history keeps. */
export const CallIdParams = Type.Object({ callId: Type.String({ pattern: '^[0-9a-f-]{36}$' }) });
export const RoomIdParams = Type.Object({ roomId: Type.String({ minLength: 1, maxLength: 64 }) });

export const RoomCalls = Ok({
  calls: Type.Array(RoomCall),
  /** Null on the last page. */
  next: Nullable(HistoryCursor),
  keepDays: Type.Number()
});
export type RoomCalls = Static<typeof RoomCalls>;
