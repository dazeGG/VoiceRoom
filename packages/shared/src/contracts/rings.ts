// New HTTP endpoints only: the existing ring.incoming event and legacy Done
// response keep their previously released shapes.
import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';
import { PublicUser } from './users.ts';

const Id = Type.String({ minLength: 1, maxLength: 36 });
export const RingIdParams = Type.Object({ ringId: Type.String({ format: 'uuid' }) });
export const RingCreateBody = Type.Object({
  roomId: Type.String({ minLength: 1, maxLength: 64 }),
  userId: Id,
  clientRequestId: Type.String({ format: 'uuid' })
});
export type RingCreateBody = Static<typeof RingCreateBody>;
export const RingRespondBody = Type.Object({ action: Type.Union([Type.Literal('accept'), Type.Literal('decline')]) });
export const RingState = Type.Union([
  Type.Literal('pending'),
  Type.Literal('accepted'),
  Type.Literal('declined'),
  Type.Literal('cancelled'),
  Type.Literal('expired')
]);
export type RingState = Static<typeof RingState>;
export const RingSnapshot = Type.Object({
  id: Id,
  callerUserId: Id,
  recipientUserId: Id,
  roomId: Type.String(),
  inviteMessageId: Id,
  state: RingState,
  revision: Type.Number(),
  createdAt: Type.Number(),
  expiresAt: Type.Number(),
  endedAt: Nullable(Type.Number()),
  reason: Type.Optional(Type.Union([Type.Literal('caller_cancelled'), Type.Literal('unavailable')]))
});
export type RingSnapshot = Static<typeof RingSnapshot>;
export const RingAnswer = Ok({ ring: RingSnapshot });
export type RingAnswer = Static<typeof RingAnswer>;

const CallId = Type.String({ format: 'uuid' });
const CallAttempt = Type.Integer({ minimum: 1 });
const CallRevision = Type.Integer({ minimum: 1 });
const Timestamp = Type.Integer({ minimum: 0 });
const CallAction = Type.Union([
  Type.Literal('accept'),
  Type.Literal('decline'),
  Type.Literal('leave'),
  Type.Literal('join'),
  Type.Literal('re-ring')
]);
const CallAccount = Type.Pick(PublicUser, ['id', 'displayName', 'avatarColorKey', 'avatarAccent', 'avatarUrl']);
export const CallEndReason = Type.Union([
  Type.Literal('ended'),
  Type.Literal('no_answer'),
  Type.Literal('declined'),
  Type.Literal('cancelled'),
  Type.Literal('alone_timeout'),
  Type.Literal('unavailable')
]);
export type CallEndReason = Static<typeof CallEndReason>;

const CallTiming = {
  startedAt: Timestamp,
  firstConnectedAt: Nullable(Timestamp),
  endedAt: Nullable(Timestamp),
  durationMs: Type.Integer({ minimum: 0 }),
  endReason: Nullable(CallEndReason),
  endedByUserId: Nullable(Id)
};

export const CallSnapshot = Type.Object({
  id: CallId,
  caller: CallAccount,
  recipient: CallAccount,
  attempt: CallAttempt,
  attemptInviterUserId: Id,
  phase: Type.Union([
    Type.Literal('ringing'),
    Type.Literal('connecting'),
    Type.Literal('connected'),
    Type.Literal('alone'),
    Type.Literal('closed')
  ]),
  attemptResult: Type.Union([
    Type.Literal('pending'),
    Type.Literal('accepted'),
    Type.Literal('no_answer'),
    Type.Literal('declined'),
    Type.Literal('cancelled')
  ]),
  revision: CallRevision,
  ringingExpiresAt: Timestamp,
  aloneDeadline: Nullable(Timestamp),
  ...CallTiming,
  allowedActions: Type.Array(CallAction, { uniqueItems: true }),
  serverNow: Timestamp,
  messageId: Id
});
export type CallSnapshot = Static<typeof CallSnapshot>;

export const CallStartBody = Type.Object({ peerUserId: Id, clientRequestId: CallId });
export type CallStartBody = Static<typeof CallStartBody>;
const CallActionFields = { clientRequestId: CallId, expectedAttempt: CallAttempt };
export const CallActionBody = Type.Union([
  Type.Object({ action: Type.Literal('accept'), ...CallActionFields }),
  Type.Object({ action: Type.Literal('decline'), ...CallActionFields }),
  Type.Object({ action: Type.Literal('leave'), ...CallActionFields }),
  Type.Object({ action: Type.Literal('join'), ...CallActionFields }),
  Type.Object({ action: Type.Literal('re-ring'), ...CallActionFields })
]);
export type CallActionBody = Static<typeof CallActionBody>;
export const CallAnswer = Ok({
  call: CallSnapshot,
  disposition: Type.Union([
    Type.Literal('start'),
    Type.Literal('accept'),
    Type.Literal('resume'),
    Type.Literal('open'),
    Type.Literal('stale')
  ])
});
export type CallAnswer = Static<typeof CallAnswer>;

export const CallIncoming = Type.Object({
  callId: CallId,
  fromUser: CallAccount,
  attempt: CallAttempt,
  revision: CallRevision,
  ringingExpiresAt: Timestamp,
  serverNow: Timestamp
});
export type CallIncoming = Static<typeof CallIncoming>;

const CallMissedWatermark = Type.Object({ missedAt: Timestamp, messageId: Id });
export const CallMissedSeenBody = Type.Object({ watermark: CallMissedWatermark });
export type CallMissedSeenBody = Static<typeof CallMissedSeenBody>;
export const CallMissedCount = Type.Object({
  peerUserId: Id,
  count: Type.Integer({ minimum: 0 }),
  watermark: Nullable(CallMissedWatermark)
});
export type CallMissedCount = Static<typeof CallMissedCount>;
export const CallMissedUpdated = Type.Object({
  ...CallMissedCount.properties,
  revision: CallRevision,
  serverNow: Timestamp
});
export const CallMissedSeenAnswer = Ok(CallMissedUpdated.properties);
export const CallBootstrap = Ok({
  enabled: Type.Boolean(),
  activeCalls: Type.Array(CallSnapshot),
  incoming: Type.Array(CallIncoming),
  missed: Type.Array(CallMissedCount),
  serverNow: Timestamp
});
export type CallBootstrap = Static<typeof CallBootstrap>;

export const DirectMessageCall = Type.Object({
  callId: CallId,
  revision: CallRevision,
  outcome: Type.Union([
    Type.Literal('live'),
    Type.Literal('completed'),
    Type.Literal('no_answer'),
    Type.Literal('declined'),
    Type.Literal('cancelled')
  ]),
  ...CallTiming,
  missedAt: Nullable(Timestamp),
  missedRevision: Nullable(CallRevision),
  missedSeenRevision: Nullable(CallRevision)
});
export type DirectMessageCall = Static<typeof DirectMessageCall>;
