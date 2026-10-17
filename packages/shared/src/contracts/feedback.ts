// "How was the call?": after leaving a call the app now and then asks for a
// thumbs up or down, what made it so, and an optional comment. Guests answer
// too. The answer carries the call's own numbers (length, company, network),
// so a bad rating can be read against what the connection did. A platform
// administrator reads the answers in the admin panel.

import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';

export const CALL_FEEDBACK_RATINGS = ['good', 'bad'] as const;
export type CallFeedbackRating = (typeof CALL_FEEDBACK_RATINGS)[number];

/** What went well; offered after a thumbs up. */
export const CALL_FEEDBACK_GOOD_TAGS = ['sound', 'connection', 'video', 'easy', 'features'] as const;
/** What went wrong; offered after a thumbs down. */
export const CALL_FEEDBACK_BAD_TAGS = [
  'poor_sound',
  'echo_noise',
  'not_heard',
  'delay',
  'drops',
  'poor_video',
  'hard_to_use'
] as const;
export const CALL_FEEDBACK_TAGS = [...CALL_FEEDBACK_GOOD_TAGS, ...CALL_FEEDBACK_BAD_TAGS] as const;
export type CallFeedbackTag = (typeof CALL_FEEDBACK_TAGS)[number];

export const CALL_FEEDBACK_TAGS_BY_RATING: Readonly<Record<CallFeedbackRating, readonly CallFeedbackTag[]>> = {
  good: CALL_FEEDBACK_GOOD_TAGS,
  bad: CALL_FEEDBACK_BAD_TAGS
};

export const CALL_FEEDBACK_COMMENT_MAX_LENGTH = 1000;

/** A longer call is sent as this long. */
export const CALL_FEEDBACK_MAX_DURATION_S = 7 * 24 * 60 * 60;

export const CALL_FEEDBACK_PLATFORMS = ['browser', 'desktop_app', 'mobile'] as const;
export type CallFeedbackPlatform = (typeof CALL_FEEDBACK_PLATFORMS)[number];

const RatingSchema = Type.Enum(CALL_FEEDBACK_RATINGS);
const TagSchema = Type.Enum(CALL_FEEDBACK_TAGS);
const Measure = Nullable(Type.Number({ minimum: 0, maximum: 100_000 }));

/** The client's own account of the call (call-quality.ts in the room client). */
export const CallFeedbackQuality = Type.Object({
  rttAvgMs: Measure,
  inboundLossAvgPct: Measure,
  outboundLossAvgPct: Measure,
  jitterAvgMs: Measure,
  reconnects: Type.Integer({ minimum: 0, maximum: 10_000 }),
  transport: Nullable(Type.Enum(['udp', 'tcp', 'relay'] as const))
});
export type CallFeedbackQuality = Static<typeof CallFeedbackQuality>;

export const CallFeedbackCall = Type.Object({
  roomId: Type.String({ minLength: 1, maxLength: 64 }),
  durationS: Type.Integer({ minimum: 0, maximum: CALL_FEEDBACK_MAX_DURATION_S }),
  /** The most other people in the call at once. */
  peers: Type.Integer({ minimum: 0, maximum: 10_000 }),
  platform: Type.Enum(CALL_FEEDBACK_PLATFORMS),
  quality: Nullable(CallFeedbackQuality)
});
export type CallFeedbackCall = Static<typeof CallFeedbackCall>;

export const CallFeedbackBody = Type.Object({
  rating: RatingSchema,
  /** Tags of the other rating are dropped. */
  tags: Type.Array(TagSchema, { maxItems: CALL_FEEDBACK_TAGS.length }),
  comment: Type.Optional(Type.String({ maxLength: CALL_FEEDBACK_COMMENT_MAX_LENGTH })),
  call: CallFeedbackCall
});
export type CallFeedbackBody = Static<typeof CallFeedbackBody>;

/** The spans the admin panel offers, in days; a query string carries text. */
export const ADMIN_CALL_FEEDBACK_PERIODS = ['7', '30', '90', '365'] as const;
export const ADMIN_CALL_FEEDBACK_DEFAULT_DAYS = 30;

export const AdminCallFeedbackQuery = Type.Object({
  days: Type.Optional(Type.Enum(ADMIN_CALL_FEEDBACK_PERIODS)),
  rating: Type.Optional(RatingSchema)
});
export type AdminCallFeedbackQuery = Static<typeof AdminCallFeedbackQuery>;

export const AdminCallFeedbackEntry = Type.Object({
  id: Type.String(),
  rating: RatingSchema,
  tags: Type.Array(TagSchema),
  comment: Type.String(),
  createdAt: Type.Number(),
  /** Null for a guest, or an account deleted since. */
  author: Nullable(Type.Object({ userId: Type.String(), login: Type.String(), displayName: Type.String() })),
  roomId: Type.String(),
  /** Null once the room is gone (a temporary room is pruned when empty). */
  roomName: Nullable(Type.String()),
  durationS: Type.Number(),
  peers: Type.Number(),
  platform: Type.Enum(CALL_FEEDBACK_PLATFORMS),
  quality: Nullable(CallFeedbackQuality)
});
export type AdminCallFeedbackEntry = Static<typeof AdminCallFeedbackEntry>;

export const AdminCallFeedbackPage = Ok({
  days: Type.Number(),
  /** Every answer of the period, whichever rating the list is filtered to. */
  summary: Type.Object({
    good: Type.Number(),
    bad: Type.Number(),
    tags: Type.Array(Type.Object({ tag: TagSchema, count: Type.Number() }))
  }),
  /** The newest answers of the period, at most ADMIN_CALL_FEEDBACK_LIMIT. */
  entries: Type.Array(AdminCallFeedbackEntry)
});
export type AdminCallFeedbackPage = Static<typeof AdminCallFeedbackPage>;

export const ADMIN_CALL_FEEDBACK_LIMIT = 200;
