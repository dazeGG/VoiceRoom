// Short-lived invitation state. This is not a voice-session or missed-call history.
import crypto from 'node:crypto';
import type pg from 'pg';
import type { RingSnapshot, RingState } from '@voice-room/shared/contracts/rings';
import { createDmThreadRepository } from '../messaging/dm-thread.repository.ts';
import type { DirectMessage } from '../social/social-records.ts';
import { isStoredDirectMessage, lockUserPair } from '../social/social-records.ts';
import { kyselyOn } from '../../platform/db/kysely.ts';
import { lockKeys, lockXact } from '../../platform/db/locks.ts';
import { transaction } from '../../platform/db/pool.ts';

interface RingRow {
  id: string;
  caller_user_id: string;
  recipient_user_id: string;
  room_id: string;
  invite_message_id: string;
  client_request_id: string;
  state: RingState;
  revision: number;
  created_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  reason: 'caller_cancelled' | 'unavailable' | null;
}
export interface RingDeliveryJob {
  ring_id: string;
  revision: number;
  recipient_user_id: string;
  kind: 'incoming' | 'terminal';
  deadline: Date;
  claim_token: string;
  attempts: number;
}
export type RingCreateResult =
  | {
      status: 'rung';
      ring: RingSnapshot;
      replay: boolean;
      message: DirectMessage | null;
      room: { name: string; emoji: string } | null;
    }
  | { status: 'not_friends' | 'blocked' | 'account_deleted' | 'room_not_found' | 'request_conflict' }
  | { status: 'rate_limited'; retryAfterSeconds: number };
export type RingAction = 'status' | 'accept' | 'decline' | 'cancel';
export type RingBanCheck = (input: {
  roomId: string;
  userId: string;
  ip: string;
  client: pg.PoolClient;
}) => Promise<boolean>;
function snapshot(row: RingRow): RingSnapshot {
  return {
    id: row.id,
    callerUserId: row.caller_user_id,
    recipientUserId: row.recipient_user_id,
    roomId: row.room_id,
    inviteMessageId: row.invite_message_id,
    state: row.state,
    revision: row.revision,
    createdAt: row.created_at.getTime(),
    expiresAt: row.expires_at.getTime(),
    endedAt: row.ended_at?.getTime() ?? null,
    ...(row.reason ? { reason: row.reason } : {})
  };
}
class CreationRejected extends Error {
  readonly result: Exclude<RingCreateResult, { status: 'rung' }>;
  constructor(result: Exclude<RingCreateResult, { status: 'rung' }>) {
    super(result.status);
    this.result = result;
  }
}
export function createRingRepository({ pool, isBanned }: { pool: pg.Pool; isBanned: RingBanCheck }) {
  const messages = createDmThreadRepository({ pool });
  async function available(client: pg.PoolClient, caller: string, recipient: string, roomId: string) {
    const active = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM users WHERE id=ANY($1::varchar[]) AND deleted_at IS NULL AND deletion_requested_at IS NULL AND (blocked_at IS NULL OR (blocked_until IS NOT NULL AND blocked_until <= clock_timestamp()))`,
      [[caller, recipient]]
    );
    if (active.rows[0]?.count !== 2) return 'account_deleted' as const;
    const [low, high] = [caller, recipient].sort();
    const friendship = await client.query<{ one: number }>(
      `SELECT 1 AS one FROM friendships WHERE user_a_id=$1 AND user_b_id=$2`,
      [low, high]
    );
    const block = await client.query<{ one: number }>(
      `SELECT 1 AS one FROM user_blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`,
      [caller, recipient]
    );
    if (!friendship.rowCount) return 'not_friends' as const;
    if (block.rowCount) return 'blocked' as const;
    const room = await client.query<{ name: string; emoji: string }>(
      `SELECT name,emoji FROM rooms WHERE id=$1 AND deleted_at IS NULL`,
      [roomId]
    );
    if (!room.rows[0]) return 'room_not_found' as const;
    return room.rows[0];
  }
  async function enqueueTerminal(client: pg.PoolClient, row: RingRow) {
    for (const userId of [row.recipient_user_id, row.caller_user_id])
      await client.query(
        `INSERT INTO ring_delivery_outbox(ring_id,revision,recipient_user_id,kind,deadline) VALUES($1,$2,$3,'terminal',clock_timestamp()+interval '5 minutes') ON CONFLICT DO NOTHING`,
        [row.id, row.revision, userId]
      );
  }
  async function terminal(
    client: pg.PoolClient,
    row: RingRow,
    state: Exclude<RingState, 'pending'>,
    reason: RingRow['reason'] = null
  ) {
    const changed = await client.query<RingRow>(
      `WITH transition AS MATERIALIZED (SELECT clock_timestamp() AS at)
       UPDATE room_rings SET state=CASE WHEN expires_at<=transition.at THEN 'expired' ELSE $2 END,
       revision=2,ended_at=transition.at,reason=CASE WHEN expires_at<=transition.at THEN NULL ELSE $3 END
       FROM transition WHERE id=$1 AND state='pending' RETURNING room_rings.*`,
      [row.id, state, reason]
    );
    const result = changed.rows[0];
    if (!result) throw new Error('Locked Ring transition was lost');
    await enqueueTerminal(client, result);
    return result;
  }
  async function create(input: {
    callerUserId: string;
    recipientUserId: string;
    roomId: string;
    clientRequestId: string;
    ttlMs: number;
    cooldownMs: number;
    limit?: number;
  }): Promise<RingCreateResult> {
    const result: {
      ring: RingSnapshot | null;
      replay: boolean;
      room: { name: string; emoji: string } | null;
    } = { ring: null, replay: false, room: null };
    try {
      const message = await messages.sendMessage({
        senderId: input.callerUserId,
        recipientId: input.recipientUserId,
        body: '',
        beforeUnitOfWork: async (client) => {
          // Request identity spans recipient pairs. Always lock it before the
          // relationship lock so conflicting payloads serialize without orphan DMs.
          await lockXact(kyselyOn(client), lockKeys.ringRequest(input.callerUserId, input.clientRequestId));
          await lockUserPair(kyselyOn(client), input.callerUserId, input.recipientUserId);
          const old = (
            await client.query<RingRow>(`SELECT * FROM room_rings WHERE caller_user_id=$1 AND client_request_id=$2`, [
              input.callerUserId,
              input.clientRequestId
            ])
          ).rows[0];
          if (old) {
            if (old.recipient_user_id !== input.recipientUserId || old.room_id !== input.roomId)
              throw new CreationRejected({ status: 'request_conflict' });
            result.ring = snapshot(old);
            result.replay = true;
            return { replay: true, message: { id: old.invite_message_id } };
          }
          const eligibility = await available(client, input.callerUserId, input.recipientUserId, input.roomId);
          if (typeof eligibility === 'string') throw new CreationRejected({ status: eligibility });
          if (input.cooldownMs > 0) {
            const cooldown =
              (
                await client.query<{ remaining: number }>(
                  `SELECT CASE WHEN count(*) >= $4 THEN ceil(($3::float8-extract(epoch FROM (clock_timestamp()-min(created_at)))*1000)/1000)::int ELSE 0 END AS remaining FROM room_rings WHERE caller_user_id=$1 AND recipient_user_id=$2 AND created_at > clock_timestamp()-$3::float8*interval '1 millisecond'`,
                  [input.callerUserId, input.recipientUserId, input.cooldownMs, input.limit ?? 1]
                )
              ).rows[0]?.remaining ?? 0;
            if (cooldown > 0) throw new CreationRejected({ status: 'rate_limited', retryAfterSeconds: cooldown });
          }
          result.room = eligibility;
          return null;
        },
        prepareMessage: async () => {
          const room = result.room;
          if (!room) throw new Error('Invitation room missing after authorization');
          return {
            body: room.name ? `Приглашение в комнату «${room.name}»` : 'Приглашение в комнату',
            metadata: {
              kind: 'room-invite',
              roomId: input.roomId,
              roomName: room.name,
              status: 'pending',
              expiresAt: null
            }
          };
        },
        unitOfWork: async (client, message) => {
          const inserted = await client.query<RingRow>(
            `INSERT INTO room_rings(id,caller_user_id,recipient_user_id,room_id,client_request_id,invite_message_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+$7::float8*interval '1 millisecond') RETURNING *`,
            [
              crypto.randomUUID(),
              input.callerUserId,
              input.recipientUserId,
              input.roomId,
              input.clientRequestId,
              message.id,
              Math.max(1, input.ttlMs)
            ]
          );
          const row = inserted.rows[0];
          if (!row) throw new Error('Ring insert did not return a row');
          result.ring = snapshot(row);
          await client.query(
            `INSERT INTO ring_delivery_outbox(ring_id,revision,recipient_user_id,kind,deadline) VALUES($1,1,$2,'incoming',$3)`,
            [row.id, row.recipient_user_id, row.expires_at]
          );
        }
      });
      if (!result.ring) throw new Error('Ring transaction completed without state');
      if (!result.replay && !isStoredDirectMessage(message))
        throw new Error('Ring invitation message failed its stored contract');
      return {
        status: 'rung',
        ring: result.ring,
        replay: result.replay,
        message: !result.replay && isStoredDirectMessage(message) ? message : null,
        room: result.room
      };
    } catch (error) {
      if (error instanceof CreationRejected) return error.result;
      throw error;
    }
  }
  async function act(input: {
    ringId: string;
    actorUserId: string;
    action: RingAction;
    ip?: string;
  }): Promise<RingSnapshot | null> {
    return transaction(pool, async (client) => {
      // Inspect immutable participants before taking the shared pair lock; the
      // row lock follows it, matching creation and relationship changes.
      const hint = (await client.query<RingRow>(`SELECT * FROM room_rings WHERE id=$1`, [input.ringId])).rows[0];
      if (!hint || ![hint.caller_user_id, hint.recipient_user_id].includes(input.actorUserId)) return null;
      if ((input.action === 'accept' || input.action === 'decline') && hint.recipient_user_id !== input.actorUserId)
        return null;
      if (input.action === 'cancel' && hint.caller_user_id !== input.actorUserId) return null;
      await lockUserPair(kyselyOn(client), hint.caller_user_id, hint.recipient_user_id);
      let row = (await client.query<RingRow>(`SELECT * FROM room_rings WHERE id=$1 FOR UPDATE`, [input.ringId]))
        .rows[0];
      if (!row) return null;
      if (row.state !== 'pending') return snapshot(row);
      const expired = (
        await client.query<{ expired: boolean }>(`SELECT clock_timestamp() >= $1::timestamptz AS expired`, [
          row.expires_at
        ])
      ).rows[0]?.expired;
      if (expired) row = await terminal(client, row, 'expired');
      else if (input.action === 'cancel') row = await terminal(client, row, 'cancelled', 'caller_cancelled');
      else if (input.action === 'decline') row = await terminal(client, row, 'declined');
      else {
        const eligibility = await available(client, row.caller_user_id, row.recipient_user_id, row.room_id);
        const banned = await isBanned({
          roomId: row.room_id,
          userId: row.recipient_user_id,
          ip: input.actorUserId === row.recipient_user_id ? (input.ip ?? '') : '',
          client
        });
        if (typeof eligibility === 'string' || banned) row = await terminal(client, row, 'cancelled', 'unavailable');
        else if (input.action === 'accept') row = await terminal(client, row, 'accepted');
        else {
          // Status also waits for authorization; never return pending based on
          // the wall clock observed before those awaited checks.
          const expiredAfterAuthorization = (
            await client.query<{ expired: boolean }>(
              `SELECT clock_timestamp() >= expires_at AS expired FROM room_rings WHERE id=$1`,
              [row.id]
            )
          ).rows[0]?.expired;
          if (expiredAfterAuthorization) row = await terminal(client, row, 'expired');
        }
      }
      return snapshot(row);
    });
  }
  async function maintenance(): Promise<void> {
    await transaction(pool, async (client) => {
      const expired = await client.query<RingRow>(
        `SELECT * FROM room_rings WHERE state='pending' AND expires_at<=clock_timestamp() ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT 100`
      );
      for (const row of expired.rows) await terminal(client, row, 'expired');
      await client.query(`DELETE FROM room_rings WHERE created_at<clock_timestamp()-interval '24 hours'`);
      await client.query(`DELETE FROM ring_delivery_outbox WHERE deadline<=clock_timestamp()`);
    });
  }
  async function claim(): Promise<RingDeliveryJob | null> {
    const token = crypto.randomUUID();
    const rows = await pool.query<RingDeliveryJob>(
      `UPDATE ring_delivery_outbox SET claim_token=$1,claimed_until=clock_timestamp()+interval '30 seconds',attempts=attempts+1 WHERE (ring_id,revision,recipient_user_id) IN (SELECT ring_id,revision,recipient_user_id FROM ring_delivery_outbox WHERE available_at<=clock_timestamp() AND deadline>clock_timestamp() AND (claimed_until IS NULL OR claimed_until<=clock_timestamp()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
      [token]
    );
    return rows.rows[0] ?? null;
  }
  async function current(job: RingDeliveryJob): Promise<RingSnapshot | null> {
    const row = (
      await pool.query<RingRow>(
        `SELECT r.* FROM room_rings r JOIN ring_delivery_outbox j ON j.ring_id=r.id WHERE r.id=$1 AND j.revision=$2 AND j.recipient_user_id=$3 AND j.claim_token=$4 AND j.claimed_until>clock_timestamp() AND j.deadline>clock_timestamp() AND (($5='incoming' AND r.state='pending' AND r.expires_at>clock_timestamp()) OR ($5='terminal' AND r.revision=$2 AND r.state<>'pending'))`,
        [job.ring_id, job.revision, job.recipient_user_id, job.claim_token, job.kind]
      )
    ).rows[0];
    return row ? snapshot(row) : null;
  }
  async function finish(job: RingDeliveryJob, retry = false): Promise<void> {
    if (retry)
      await pool.query(
        `UPDATE ring_delivery_outbox SET claim_token=NULL,claimed_until=NULL,available_at=clock_timestamp()+$5::float8*interval '1 second' WHERE ring_id=$1 AND revision=$2 AND recipient_user_id=$3 AND claim_token=$4`,
        [
          job.ring_id,
          job.revision,
          job.recipient_user_id,
          job.claim_token,
          Math.min(30, 2 ** Math.min(job.attempts, 5))
        ]
      );
    else
      await pool.query(
        `DELETE FROM ring_delivery_outbox WHERE ring_id=$1 AND revision=$2 AND recipient_user_id=$3 AND claim_token=$4`,
        [job.ring_id, job.revision, job.recipient_user_id, job.claim_token]
      );
  }
  return { create, act, maintenance, claim, current, finish };
}
export type RingRepository = ReturnType<typeof createRingRepository>;
