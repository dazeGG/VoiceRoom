import crypto from 'node:crypto';
import { sql, type ExpressionBuilder, type Selectable } from 'kysely';
import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';
import type { DB, MessageDeliveryOutbox } from '../../platform/db/schema.ts';
import { isOneOf, isRecord } from '@voice-room/shared/guards';
import {
  DELIVERY_EVENT_TYPES,
  buildMessageDeliveryEvent,
  type MessageDeliveryEvent
} from '@voice-room/shared/messaging-send';

const DEFAULT_CLAIM_LIMIT = 100;
const DEFAULT_STALE_CLAIM_MS = 60_000;

type QueryClient = Pick<pg.Pool, 'query'>;

type OutboxRow = Selectable<MessageDeliveryOutbox>;

export type OutboxEvent = Readonly<{
  eventId: string;
  logicalKey: string;
  type: MessageDeliveryEvent['type'];
  conversation: Readonly<{ type: 'room' | 'dm'; id: string }>;
  messageId: string;
  revision: number;
  payload: unknown;
  attempts: number;
  fencingToken: number | null;
}>;

export type DeliveryLease = { identity: string; ownerId: string; fencingToken: number };

class MessageDeliveryFenceError extends Error {
  declare code: string;

  constructor(message = 'Message delivery fencing token is no longer active') {
    super(message);
    this.name = 'MessageDeliveryFenceError';
    this.code = 'MESSAGE_DELIVERY_FENCE_LOST';
  }
}

function encodeParts(parts: string[]): string {
  return parts.map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('|');
}

function logicalKey(event: MessageDeliveryEvent, revision: number): string {
  return crypto
    .createHash('sha256')
    .update(
      encodeParts([event.type, event.conversation.type, event.conversation.id, event.messageId, String(revision)])
    )
    .digest('hex');
}

function positiveInteger(value: unknown, fallback: number, max: number = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

const now = sql<Date>`current_timestamp`;
const after = (ms: number) => sql<Date>`current_timestamp + (${ms} * interval '1 millisecond')`;

// The worker still holds this lease: same owner, same fence, not expired.
function holdsLease(eb: ExpressionBuilder<DB, 'message_delivery_outbox'>, lease: DeliveryLease) {
  return eb.exists(
    eb
      .selectFrom('message_delivery_leases')
      .select('identity')
      .where('identity', '=', lease.identity)
      .where('owner_id', '=', lease.ownerId)
      .where('fencing_token', '=', String(lease.fencingToken))
      .where('expires_at', '>', now)
  );
}

// The table's checks allow only these event and conversation types.
function mapOutboxRow(row: OutboxRow): OutboxEvent {
  const type = isOneOf(DELIVERY_EVENT_TYPES, row.event_type) ? row.event_type : null;
  const conversationType = isOneOf(['room', 'dm'], row.conversation_type) ? row.conversation_type : null;
  if (!type || !conversationType) throw new TypeError(`Outbox event ${row.event_id} has an unknown type`);
  return Object.freeze({
    eventId: row.event_id,
    logicalKey: row.logical_key,
    type,
    conversation: Object.freeze({ type: conversationType, id: row.conversation_id }),
    messageId: row.message_id,
    revision: Number(row.revision),
    payload: row.payload,
    attempts: Number(row.attempts),
    fencingToken: row.claimed_fencing_token === null ? null : Number(row.claimed_fencing_token)
  });
}

function createMessageOutboxRepository({ pool }: { pool: QueryClient }) {
  const db = kyselyOn(pool);

  // Written in the caller's transaction, next to the message it announces; the
  // same event and revision is queued once.
  async function enqueue(
    client: QueryClient,
    value: Record<string, unknown>,
    { revision = 1 }: { revision?: unknown } = {}
  ): Promise<OutboxEvent> {
    const normalizedRevision = positiveInteger(revision, 1);
    const event = buildMessageDeliveryEvent(value);
    if (!event) throw new TypeError('A valid message delivery event is required');
    const row = await kyselyOn(client)
      .insertInto('message_delivery_outbox')
      .values({
        event_id: event.eventId,
        logical_key: logicalKey(event, normalizedRevision),
        event_type: event.type,
        conversation_type: event.conversation.type,
        conversation_id: event.conversation.id,
        message_id: event.messageId,
        revision: normalizedRevision,
        payload: JSON.stringify(event)
      })
      .onConflict((oc) =>
        oc.column('logical_key').doUpdateSet((eb) => ({ logical_key: eb.ref('excluded.logical_key') }))
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return mapOutboxRow(row);
  }

  // A lease is taken when it is free or expired, or renewed by its owner; each
  // acquisition moves the fence.
  async function acquireLease({
    identity,
    leaseMs,
    ownerId
  }: {
    identity: string;
    leaseMs?: unknown;
    ownerId: string;
  }): Promise<{ acquired: false } | { acquired: true; fencingToken: number; expiresAt: unknown }> {
    const row = await db
      .insertInto('message_delivery_leases')
      .values({
        identity,
        owner_id: ownerId,
        fencing_token: 1,
        expires_at: after(positiveInteger(leaseMs, 30_000)),
        heartbeat_at: now,
        ready: false,
        updated_at: now
      })
      .onConflict((oc) =>
        oc
          .column('identity')
          .doUpdateSet((eb) => ({
            owner_id: eb.ref('excluded.owner_id'),
            fencing_token: sql<string>`message_delivery_leases.fencing_token + 1`,
            expires_at: eb.ref('excluded.expires_at'),
            heartbeat_at: now,
            ready: false,
            updated_at: now
          }))
          .where((eb) =>
            eb.or([
              eb('message_delivery_leases.expires_at', '<=', now),
              eb('message_delivery_leases.owner_id', '=', eb.ref('excluded.owner_id'))
            ])
          )
      )
      .returning(['fencing_token', 'expires_at'])
      .executeTakeFirst();
    if (!row) return { acquired: false };
    return { acquired: true, fencingToken: Number(row.fencing_token), expiresAt: row.expires_at };
  }

  function ownLease(lease: DeliveryLease) {
    return db
      .updateTable('message_delivery_leases')
      .where('identity', '=', lease.identity)
      .where('owner_id', '=', lease.ownerId)
      .where('fencing_token', '=', String(lease.fencingToken));
  }

  async function renewLease({
    leaseMs,
    ...lease
  }: DeliveryLease & { leaseMs?: unknown }): Promise<{ renewed: true; expiresAt: unknown } | { renewed: false }> {
    const row = await ownLease(lease)
      .set({ expires_at: after(positiveInteger(leaseMs, 30_000)), heartbeat_at: now, ready: true, updated_at: now })
      .where('expires_at', '>', now)
      .returning('expires_at')
      .executeTakeFirst();
    return row ? { renewed: true, expiresAt: row.expires_at } : { renewed: false };
  }

  async function releaseLease(lease: DeliveryLease): Promise<void> {
    await ownLease(lease).set({ expires_at: now, ready: false, updated_at: now }).execute();
  }

  async function recordHeartbeat({ ready, ...lease }: DeliveryLease & { ready?: unknown }): Promise<boolean> {
    const result = await ownLease(lease)
      .set({ heartbeat_at: now, ready: Boolean(ready), updated_at: now })
      .where('expires_at', '>', now)
      .executeTakeFirst();
    return result.numUpdatedRows === 1n;
  }

  // Claims due events, and events whose claim went stale, but only while the
  // lease is held; the claim records the fence it was made under.
  async function claimBatch({
    fencingToken,
    identity,
    limit = DEFAULT_CLAIM_LIMIT,
    ownerId,
    staleClaimMs = DEFAULT_STALE_CLAIM_MS
  }: DeliveryLease & { limit?: unknown; staleClaimMs?: unknown }): Promise<OutboxEvent[]> {
    const staleBefore = sql<Date>`current_timestamp - (${positiveInteger(staleClaimMs, DEFAULT_STALE_CLAIM_MS)} * interval '1 millisecond')`;
    const rows = await db
      .with('active_lease', (qb) =>
        qb
          .selectFrom('message_delivery_leases')
          .select('identity')
          .where('identity', '=', identity)
          .where('owner_id', '=', ownerId)
          .where('fencing_token', '=', String(fencingToken))
          .where('expires_at', '>', now)
      )
      .with('candidates', (qb) =>
        qb
          .selectFrom('message_delivery_outbox')
          .select('event_id')
          .where((eb) =>
            eb.or([
              eb.and([eb('status', '=', 'pending'), eb('available_at', '<=', now)]),
              eb.and([eb('status', '=', 'processing'), eb('claimed_at', '<=', staleBefore)])
            ])
          )
          .orderBy('available_at')
          .orderBy('created_at')
          .orderBy('event_id')
          .forUpdate()
          .skipLocked()
          .limit(positiveInteger(limit, DEFAULT_CLAIM_LIMIT, 1_000))
      )
      .updateTable('message_delivery_outbox as outbox')
      .from(['candidates', 'active_lease'])
      .set((eb) => ({
        status: 'processing',
        attempts: eb('outbox.attempts', '+', 1),
        claimed_at: now,
        claimed_fencing_token: String(fencingToken),
        updated_at: now
      }))
      .whereRef('outbox.event_id', '=', 'candidates.event_id')
      .returningAll('outbox')
      .execute();
    return rows.map(mapOutboxRow);
  }

  function claimedUnderLease(eventId: string, lease: DeliveryLease) {
    return db
      .updateTable('message_delivery_outbox')
      .where('event_id', '=', eventId)
      .where('status', '=', 'processing')
      .where('claimed_fencing_token', '=', String(lease.fencingToken))
      .where((eb) => holdsLease(eb, lease));
  }

  async function markDelivered(eventId: string, lease: DeliveryLease): Promise<void> {
    const result = await claimedUnderLease(eventId, lease)
      .set({
        status: 'delivered',
        delivered_at: now,
        claimed_at: null,
        claimed_fencing_token: null,
        last_error: null,
        updated_at: now
      })
      .executeTakeFirst();
    if (!result.numUpdatedRows) throw new MessageDeliveryFenceError();
  }

  // A failed delivery goes back to pending after the delay, or dead once it
  // has used its attempts.
  async function reschedule(
    eventId: string,
    lease: DeliveryLease,
    {
      delayMs,
      error,
      maxAttempts = 12
    }: {
      delayMs?: unknown;
      error?: unknown;
      maxAttempts?: unknown;
    } = {}
  ): Promise<void> {
    const reason = (isRecord(error) && error.message) || error || 'Message delivery failed';
    const message = (typeof reason === 'string' ? reason : 'Message delivery failed').slice(0, 2_000);
    const attemptsLeft = sql<boolean>`attempts < ${positiveInteger(maxAttempts, 12, 100)}`;
    const result = await claimedUnderLease(eventId, lease)
      .set({
        status: sql<string>`CASE WHEN ${attemptsLeft} THEN 'pending' ELSE 'dead' END`,
        available_at: sql<Date>`CASE WHEN ${attemptsLeft}
          THEN ${after(positiveInteger(delayMs, 1_000, 60 * 60 * 1000))} ELSE available_at END`,
        dead_at: sql<Date | null>`CASE WHEN ${attemptsLeft} THEN NULL ELSE current_timestamp END`,
        claimed_at: null,
        claimed_fencing_token: null,
        last_error: message,
        updated_at: now
      })
      .executeTakeFirst();
    if (!result.numUpdatedRows) throw new MessageDeliveryFenceError();
  }

  async function publishPostgres(
    event: { eventId: string },
    { channel = 'voice_room_message_delivery' }: { channel?: string } = {}
  ): Promise<void> {
    if (!/^[a-z][a-z0-9_]{0,62}$/i.test(channel)) throw new TypeError('Invalid PostgreSQL notification channel');
    await sql`SELECT pg_notify(${channel}, ${JSON.stringify({ eventId: event.eventId })})`.execute(db);
  }

  async function getEvent(eventId: string): Promise<OutboxEvent | null> {
    const row = await db
      .selectFrom('message_delivery_outbox')
      .selectAll()
      .where('event_id', '=', eventId)
      .limit(1)
      .executeTakeFirst();
    return row ? mapOutboxRow(row) : null;
  }

  // What the worker delivered from `since` on, oldest first: the events an API
  // replica missed while its LISTEN connection was down.
  async function listDeliveredSince(since: Date, limit = 500): Promise<OutboxEvent[]> {
    const rows = await db
      .selectFrom('message_delivery_outbox')
      .selectAll()
      .where('status', '=', 'delivered')
      .where('delivered_at', '>=', since)
      .orderBy('delivered_at')
      .orderBy('event_id')
      .limit(positiveInteger(limit, 500, 1_000))
      .execute();
    return rows.map(mapOutboxRow);
  }

  return Object.freeze({
    acquireLease,
    claimBatch,
    enqueue,
    getEvent,
    listDeliveredSince,
    markDelivered,
    publishPostgres,
    recordHeartbeat,
    releaseLease,
    renewLease,
    reschedule
  });
}

export { MessageDeliveryFenceError, createMessageOutboxRepository };
