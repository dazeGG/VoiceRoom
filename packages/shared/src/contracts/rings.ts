// New HTTP endpoints only: the existing ring.incoming event and legacy Done
// response keep their previously released shapes.
import { Type, type Static } from 'typebox';
import { Nullable, Ok } from './http.ts';

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
