import { randomUUID } from 'node:crypto';
import { sql, type Selectable, type Updateable } from 'kysely';
import type pg from 'pg';
import {
  CallEndReason,
  CallSnapshot,
  type CallMissedSeenBody,
  type CallMissedUpdated,
  type DirectMessageCall
} from '@voiceroom/shared/contracts/rings';
import { Value } from 'typebox/value';
import { kyselyOn, withTransaction, type Database } from '../../platform/db/kysely.ts';
import { lockKeys, lockXact } from '../../platform/db/locks.ts';
import type { RoomRings } from '../../platform/db/schema.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import { createDmThreadRepository } from '../messaging/dm-thread.repository.ts';
import {
  findCallMessagePeer,
  listMissedCalls,
  lockCallMessage,
  markCallMissesSeen,
  nextMissedRevision,
  updateCallMessage
} from '../messaging/call-history.repository.ts';
import { createCallRoom, deleteCallRoom } from '../rooms/room.repository.ts';
import { ringPairRefusal } from '../social/pair-eligibility.repository.ts';
import { lockUserPair, mapPublicUser, type DirectMessage } from '../social/social-records.ts';
import { CALL_DISMISSAL_TTL_MS, CALL_MISSED_TTL_MS, enqueueCallPush } from './call-push.repository.ts';

export const RING_WINDOW_MS = 45_000;
export const ALONE_WINDOW_MS = 300_000;
export const CALL_RETENTION_MS = 86_400_000;
const MESSAGE_BODY = 'Voice call';

export type VoiceCall = Pick<
  CallSnapshot,
  | 'id'
  | 'attempt'
  | 'attemptInviterUserId'
  | 'phase'
  | 'attemptResult'
  | 'revision'
  | 'ringingExpiresAt'
  | 'aloneDeadline'
  | 'startedAt'
  | 'firstConnectedAt'
  | 'endedAt'
  | 'endReason'
  | 'endedByUserId'
  | 'messageId'
> & {
  callerId: string;
  recipientId: string;
  roomId: string;
  mutualMs: number;
  mutualSince: number | null;
};

export function callDuration(call: VoiceCall, now: number): number {
  return call.mutualMs + (call.mutualSince === null ? 0 : Math.max(0, now - call.mutualSince));
}

function toCall(row: Selectable<RoomRings>): VoiceCall | null {
  const phase = row.call_phase;
  const attemptResult = row.attempt_result;
  const endReason = row.end_reason;
  if (row.started_at === null) return null;
  if (
    !Value.Check(CallSnapshot.properties.phase, phase) ||
    !Value.Check(CallSnapshot.properties.attemptResult, attemptResult) ||
    (endReason !== null && !Value.Check(CallEndReason, endReason)) ||
    row.attempt === null ||
    row.call_revision === null ||
    row.mutual_ms === null ||
    !row.attempt_inviter_user_id ||
    !row.ringing_expires_at ||
    !row.invite_message_id
  )
    throw new Error('Invalid published call row');
  return {
    id: row.id,
    roomId: row.room_id,
    callerId: row.caller_user_id,
    recipientId: row.recipient_user_id,
    messageId: row.invite_message_id,
    phase,
    attemptResult,
    attempt: row.attempt,
    attemptInviterUserId: row.attempt_inviter_user_id,
    revision: row.call_revision,
    startedAt: row.started_at.getTime(),
    ringingExpiresAt: row.ringing_expires_at.getTime(),
    aloneDeadline: row.alone_deadline?.getTime() ?? null,
    firstConnectedAt: row.first_connected_at?.getTime() ?? null,
    mutualMs: Number(row.mutual_ms),
    mutualSince: row.mutual_since?.getTime() ?? null,
    endedAt: row.closed_at?.getTime() ?? null,
    endReason,
    endedByUserId: row.ended_by_user_id
  };
}

function callMetadata(call: VoiceCall, prior?: DirectMessageCall): { kind: 'voice-call'; call: DirectMessageCall } {
  return {
    kind: 'voice-call',
    call: {
      callId: call.id,
      revision: call.revision,
      outcome:
        call.endedAt === null
          ? 'live'
          : call.firstConnectedAt !== null
            ? 'completed'
            : call.endReason === 'declined'
              ? 'declined'
              : call.attemptResult === 'no_answer' || (prior?.missedAt != null && call.endReason !== 'cancelled')
                ? 'no_answer'
                : 'cancelled',
      startedAt: call.startedAt,
      firstConnectedAt: call.firstConnectedAt,
      endedAt: call.endedAt,
      endReason: call.endReason,
      endedByUserId: call.endedByUserId,
      durationMs: call.mutualMs,
      missedAt: call.firstConnectedAt === null ? (prior?.missedAt ?? null) : null,
      missedRevision: call.firstConnectedAt === null ? (prior?.missedRevision ?? null) : null,
      missedSeenRevision: call.firstConnectedAt === null ? (prior?.missedSeenRevision ?? null) : null
    }
  };
}

function date(time: number | null): Date | null {
  return time === null ? null : new Date(time);
}

function stateColumns(call: VoiceCall) {
  return {
    attempt: call.attempt,
    attempt_inviter_user_id: call.attemptInviterUserId,
    call_phase: call.phase,
    attempt_result: call.attemptResult,
    call_revision: call.revision,
    ringing_expires_at: new Date(call.ringingExpiresAt),
    alone_deadline: date(call.aloneDeadline),
    first_connected_at: date(call.firstConnectedAt),
    closed_at: date(call.endedAt),
    end_reason: call.endReason,
    ended_by_user_id: call.endedByUserId,
    mutual_ms: String(call.mutualMs),
    mutual_since: date(call.mutualSince)
  } satisfies Updateable<RoomRings>;
}

type StartResult =
  | { status: 'created'; call: VoiceCall; now: number; message: DirectMessage }
  | { status: 'open' | 'replay'; call: VoiceCall; now: number }
  | { status: 'rate_limited'; retryAfterSeconds: number };

function firstAttemptExpired(prior: VoiceCall, current: VoiceCall, now: number): boolean {
  return (
    prior.attempt === 1 &&
    prior.ringingExpiresAt <= now &&
    (prior.attemptResult === 'no_answer' || (prior.phase === 'ringing' && current.attemptResult === 'no_answer'))
  );
}

export function createCallRingRepository(pool: pg.Pool, clock?: () => number) {
  const db = kyselyOn(pool);
  const messages = createDmThreadRepository({ pool });
  const calls = (query: Database) =>
    query.selectFrom('room_rings').selectAll().where('purpose', '=', 'voice-call').where('started_at', 'is not', null);
  const participants = (query: Database, userId: string) =>
    calls(query).where((eb) => eb.or([eb('caller_user_id', '=', userId), eb('recipient_user_id', '=', userId)]));

  async function now(query = db): Promise<number> {
    if (clock) return clock();
    return (await query.selectNoFrom(sql<Date>`clock_timestamp()`.as('now')).executeTakeFirstOrThrow()).now.getTime();
  }

  async function missedUpdate(
    trx: Database,
    recipientId: string,
    peerId: string,
    stamp: number,
    revision?: number
  ): Promise<CallMissedUpdated> {
    const [missed] = await listMissedCalls(trx, recipientId, peerId);
    return {
      ...(missed ?? { peerUserId: peerId, count: 0, watermark: null }),
      revision: revision ?? (await nextMissedRevision(trx)),
      serverNow: stamp
    };
  }

  async function acknowledgeMissed(recipientId: string, peerId: string, watermark?: CallMissedSeenBody['watermark']) {
    return withTransaction(db, async (trx) => {
      await lockUserPair(trx, recipientId, peerId);
      if (watermark) await markCallMissesSeen(trx, recipientId, peerId, watermark);
      return missedUpdate(trx, recipientId, peerId, await now(trx));
    });
  }

  async function messagePeer(viewer: string, callId: string) {
    const peer = await findCallMessagePeer(db, viewer, callId);
    return peer && !(await ringPairRefusal(db, viewer, peer)) ? peer : null;
  }

  async function updateHistory(
    trx: Database,
    prior: VoiceCall,
    call: VoiceCall,
    stamp: number,
    message: DirectMessage | null
  ) {
    if (!message?.call) return {};
    const projection = callMetadata(call, message.call).call;
    let watermark: { order: number; missedAt: number } | undefined;
    if (prior.firstConnectedAt === null && call.firstConnectedAt === null && message.call.missedAt === null) {
      const expired = firstAttemptExpired(prior, call, stamp) && call.endReason !== 'unavailable';
      const cancelled =
        prior.phase === 'ringing' && call.endReason === 'cancelled' && call.endedByUserId === call.callerId;
      if (expired || cancelled) {
        projection.missedAt = expired ? prior.ringingExpiresAt : stamp;
        projection.missedRevision = call.revision;
        watermark = { order: await nextMissedRevision(trx), missedAt: projection.missedAt };
      }
    }
    const edited = await updateCallMessage(trx, call.messageId, projection, watermark);
    if (!edited) return {};
    if (watermark) {
      await enqueueCallPush(trx, 'call-missed', call, call.recipientId, stamp, stamp + CALL_MISSED_TTL_MS);
      return {
        message: edited,
        missed: await missedUpdate(trx, call.recipientId, call.callerId, stamp, watermark.order)
      };
    }
    if (message.call.missedAt !== null && projection.missedAt === null) {
      await enqueueCallPush(trx, 'call-dismissal', call, call.recipientId, stamp, stamp + CALL_MISSED_TTL_MS);
      if (message.call.missedSeenRevision === null) {
        return { message: edited, missed: await missedUpdate(trx, call.recipientId, call.callerId, stamp) };
      }
    }
    return { message: edited };
  }

  async function start(
    callerId: string,
    recipientId: string,
    clientRequestId: string,
    limits: { count: number; windowMs: number }
  ): Promise<StartResult> {
    let provisioned: VoiceCall | null = null;
    const outcome = await messages.sendMessage<StartResult>({
      senderId: callerId,
      recipientId,
      body: MESSAGE_BODY,
      alreadyRead: true,
      beforeUnitOfWork: async (client) => {
        const trx = kyselyOn(client);
        await lockXact(trx, lockKeys.ringRequest(callerId, clientRequestId));
        await lockUserPair(trx, callerId, recipientId);
        const stamp = await now(trx);
        const old = await trx
          .selectFrom('room_rings')
          .selectAll()
          .where('caller_user_id', '=', callerId)
          .where('client_request_id', '=', clientRequestId)
          .executeTakeFirst();
        if (old) {
          const existing = old.purpose === 'voice-call' ? toCall(old) : null;
          if (!existing || existing.recipientId !== recipientId)
            throw new DomainError('call_request_conflict', 409, 'Call request ID is already in use');
          return { replay: true, message: { status: 'replay', call: existing, now: stamp } };
        }
        const refusal = await ringPairRefusal(trx, callerId, recipientId);
        if (refusal)
          throw new DomainError(refusal === 'blocked' ? 'relationship_blocked' : refusal, 403, 'Call unavailable');
        const existing = await participants(trx, callerId)
          .where('call_phase', '!=', 'closed')
          .where((eb) =>
            eb.or([
              eb.and([eb('caller_user_id', '=', callerId), eb('recipient_user_id', '=', recipientId)]),
              eb.and([eb('caller_user_id', '=', recipientId), eb('recipient_user_id', '=', callerId)])
            ])
          )
          .executeTakeFirst();
        const open = existing && toCall(existing);
        if (open) return { replay: true, message: { status: 'open', call: open, now: stamp } };

        if (limits.count > 0) {
          const recent = await calls(trx)
            .clearSelect()
            .select(['created_at', 'recipient_user_id'])
            .where('caller_user_id', '=', callerId)
            .where('created_at', '>', new Date(stamp - limits.windowMs))
            .orderBy('created_at', 'desc')
            .limit(limits.count * 4)
            .execute();
          const pair = recent.filter((row) => row.recipient_user_id === recipientId);
          const oldest = Math.max(
            pair[limits.count - 1]?.created_at.getTime() ?? -Infinity,
            recent[limits.count * 4 - 1]?.created_at.getTime() ?? -Infinity
          );
          if (Number.isFinite(oldest)) {
            const retryAfterSeconds = Math.ceil((oldest + limits.windowMs - stamp) / 1_000);
            return { replay: true, message: { status: 'rate_limited', retryAfterSeconds } };
          }
        }

        const room = await createCallRoom(trx, stamp);
        provisioned = {
          id: randomUUID(),
          roomId: room.id,
          callerId,
          recipientId,
          messageId: '',
          phase: 'ringing',
          attemptResult: 'pending',
          attempt: 1,
          attemptInviterUserId: callerId,
          revision: 1,
          startedAt: stamp,
          ringingExpiresAt: stamp + RING_WINDOW_MS,
          aloneDeadline: stamp + ALONE_WINDOW_MS,
          firstConnectedAt: null,
          endedAt: null,
          endReason: null,
          endedByUserId: null,
          mutualMs: 0,
          mutualSince: null
        };
      },
      prepareMessage: async () => {
        if (!provisioned) throw new Error('Call room was not reserved');
        return { body: MESSAGE_BODY, metadata: callMetadata(provisioned) };
      },
      unitOfWork: async (client, message) => {
        if (!provisioned) throw new Error('Call room was not reserved');
        provisioned.messageId = message.id;
        const trx = kyselyOn(client);
        await trx
          .insertInto('room_rings')
          .values({
            ...stateColumns(provisioned),
            id: provisioned.id,
            purpose: 'voice-call',
            state: null,
            revision: null,
            caller_user_id: callerId,
            recipient_user_id: recipientId,
            room_id: provisioned.roomId,
            client_request_id: clientRequestId,
            invite_message_id: message.id,
            created_at: new Date(provisioned.startedAt),
            started_at: new Date(provisioned.startedAt)
          })
          .execute();
        await enqueueCallPush(
          trx,
          'call-incoming',
          provisioned,
          recipientId,
          provisioned.startedAt,
          provisioned.ringingExpiresAt
        );
      }
    });
    if ('status' in outcome) return outcome;
    if (!provisioned) throw new Error('Call was not stored');
    const call: VoiceCall = provisioned;
    return { status: 'created', call, now: call.startedAt, message: outcome };
  }

  async function update<T>(
    id: string,
    viewer: string | null,
    transition: (call: VoiceCall, now: number, eligible: boolean) => { call: VoiceCall; result: T }
  ) {
    return withTransaction(db, async (trx) => {
      const query = viewer === null ? calls(trx) : participants(trx, viewer);
      const hint = await query.where('id', '=', id).executeTakeFirst();
      if (!hint) return null;
      await lockUserPair(trx, hint.caller_user_id, hint.recipient_user_id);
      const row = await query.where('id', '=', id).forUpdate().executeTakeFirst();
      const call = row && toCall(row);
      if (!call) return null;
      const stamp = await now(trx);
      const eligible = call.phase !== 'closed' && !(await ringPairRefusal(trx, call.callerId, call.recipientId));
      const next = transition(call, stamp, eligible);
      const recoveredExpiry =
        eligible &&
        next.call === call &&
        call.phase === 'alone' &&
        call.firstConnectedAt === null &&
        firstAttemptExpired(call, call, stamp);
      const message = next.call !== call || recoveredExpiry ? await lockCallMessage(trx, call.messageId) : null;
      if (recoveredExpiry && message?.call?.missedAt === null) next.call = { ...call };
      if (next.call !== call) {
        next.call.revision = call.revision + 1;
        await trx.updateTable('room_rings').set(stateColumns(next.call)).where('id', '=', id).execute();
        const updated = next.call;
        if (call.phase === 'ringing' && (updated.phase !== 'ringing' || call.attempt !== updated.attempt)) {
          const target = call.attemptInviterUserId === call.callerId ? call.recipientId : call.callerId;
          await enqueueCallPush(
            trx,
            'call-dismissal',
            { ...updated, attempt: call.attempt },
            target,
            stamp,
            stamp + CALL_DISMISSAL_TTL_MS
          );
        }
        if (updated.phase === 'ringing' && updated.attempt !== call.attempt) {
          const target = updated.attemptInviterUserId === updated.callerId ? updated.recipientId : updated.callerId;
          await enqueueCallPush(trx, 'call-incoming', updated, target, stamp, updated.ringingExpiresAt);
        }
        return { ...next, changed: true, now: stamp, ...(await updateHistory(trx, call, updated, stamp, message)) };
      }
      return { ...next, changed: next.call !== call, now: stamp };
    });
  }

  async function list(viewer?: string) {
    const query = viewer === undefined ? calls(db) : participants(db, viewer);
    const rows = await query.where('call_phase', '!=', 'closed').orderBy('created_at', 'asc').execute();
    return rows.flatMap((row) => toCall(row) ?? []);
  }

  async function listClosed(closedBefore?: number) {
    let query = calls(db).where('call_phase', '=', 'closed');
    if (closedBefore !== undefined) query = query.where('closed_at', '<=', new Date(closedBefore));
    const rows = await query.execute();
    return rows.flatMap((row) => toCall(row) ?? []);
  }

  async function fromRoom(roomId: string) {
    const row = await calls(db).where('room_id', '=', roomId).executeTakeFirst();
    return row ? toCall(row) : null;
  }

  async function profiles(call: VoiceCall) {
    const rows = await db
      .selectFrom('users')
      .select([
        'id',
        'login',
        'display_name',
        'avatar_accent',
        'avatar_color_key',
        'avatar_key',
        'created_at',
        'dnd',
        'presence_status'
      ])
      .where('id', 'in', [call.callerId, call.recipientId])
      .execute();
    const caller = rows.find((row) => row.id === call.callerId);
    const recipient = rows.find((row) => row.id === call.recipientId);
    if (!caller || !recipient) throw new Error('Call participants are missing');
    const profile = (row: typeof caller) => {
      const { id, displayName, avatarColorKey, avatarAccent, avatarUrl } = mapPublicUser(row);
      return { id, displayName, avatarColorKey, avatarAccent, avatarUrl };
    };
    return { caller: profile(caller), recipient: profile(recipient) };
  }

  async function prune(call: VoiceCall, now: number) {
    if (call.endedAt === null || call.endedAt + CALL_RETENTION_MS > now) return false;
    await withTransaction(db, async (trx) => {
      await trx.deleteFrom('room_rings').where('id', '=', call.id).execute();
      await deleteCallRoom(trx, call.roomId);
    });
    return true;
  }

  return {
    start,
    update,
    list,
    listClosed,
    fromRoom,
    profiles,
    now,
    prune,
    acknowledgeMissed,
    messagePeer,
    listMissed: (recipientId: string) => listMissedCalls(db, recipientId)
  };
}

export type CallRingRepository = ReturnType<typeof createCallRingRepository>;
