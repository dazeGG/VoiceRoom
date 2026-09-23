import crypto from 'node:crypto';
import type pg from 'pg';
import { buildMessageDeliveryEvent, type MessageDeliveryEvent } from '@voice-room/shared/messaging-send';

const DEFAULT_CLAIM_LIMIT = 100;
const DEFAULT_STALE_CLAIM_MS = 60_000;

type QueryClient = Pick<pg.Pool, 'query'>;

type OutboxRow = {
  event_id: string;
  logical_key: string;
  event_type: MessageDeliveryEvent['type'];
  conversation_type: 'room' | 'dm';
  conversation_id: string;
  message_id: string;
  revision: number | string;
  payload: unknown;
  attempts: number | string;
  claimed_fencing_token: number | string | null;
};

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

function requireQuery(value: unknown, label = 'PostgreSQL executor'): asserts value is QueryClient {
  if (!value || typeof (value as QueryClient).query !== 'function') throw new TypeError(`${label} is required`);
}

function encodeParts(parts: string[]): string {
  return parts.map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('|');
}

function logicalKey(event: MessageDeliveryEvent, revision: number): string {
  return crypto.createHash('sha256').update(encodeParts([
    event.type,
    event.conversation.type,
    event.conversation.id,
    event.messageId,
    String(revision)
  ])).digest('hex');
}

function positiveInteger(value: unknown, fallback: number, max: number = Number.MAX_SAFE_INTEGER): number {
  const parsed = Number.parseInt(value as string, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function mapOutboxRow(row: OutboxRow): OutboxEvent {
  return Object.freeze({
    eventId: row.event_id,
    logicalKey: row.logical_key,
    type: row.event_type,
    conversation: Object.freeze({ type: row.conversation_type, id: row.conversation_id }),
    messageId: row.message_id,
    revision: Number(row.revision),
    payload: row.payload,
    attempts: Number(row.attempts),
    fencingToken: row.claimed_fencing_token === null ? null : Number(row.claimed_fencing_token)
  });
}

function createMessageOutboxRepository({ pool }: { pool?: QueryClient | null } = {}) {
  requireQuery(pool, 'PostgreSQL pool');
  const db = pool;

  async function enqueue(client: unknown, value: Record<string, unknown>, { revision = 1 }: { revision?: unknown } = {}): Promise<OutboxEvent> {
    requireQuery(client, 'Active PostgreSQL transaction client');
    const normalizedRevision = positiveInteger(revision, 1);
    const event = buildMessageDeliveryEvent(value);
    if (!event) throw new TypeError('A valid message delivery event is required');
    const identity = logicalKey(event, normalizedRevision);

    const result = await client.query<OutboxRow>(
      `INSERT INTO message_delivery_outbox (
         event_id, logical_key, event_type, conversation_type, conversation_id,
         message_id, revision, payload
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (logical_key) DO UPDATE SET logical_key = EXCLUDED.logical_key
       RETURNING *`,
      [
        event.eventId,
        identity,
        event.type,
        event.conversation.type,
        event.conversation.id,
        event.messageId,
        normalizedRevision,
        JSON.stringify(event)
      ]
    );
    // The upsert always returns the row, fresh or already queued.
    return mapOutboxRow(result.rows[0]!);
  }

  async function acquireLease({ identity, leaseMs, ownerId }: { identity: string; leaseMs?: unknown; ownerId: string }):
    Promise<{ acquired: false } | { acquired: true; fencingToken: number; expiresAt: unknown }> {
    const result = await db.query<{ fencing_token: number | string; expires_at: unknown }>(
      `INSERT INTO message_delivery_leases (
         identity, owner_id, fencing_token, expires_at, heartbeat_at, ready, updated_at
       ) VALUES ($1, $2, 1, current_timestamp + ($3 * interval '1 millisecond'), current_timestamp, false, current_timestamp)
       ON CONFLICT (identity) DO UPDATE SET
         owner_id = EXCLUDED.owner_id,
         fencing_token = message_delivery_leases.fencing_token + 1,
         expires_at = EXCLUDED.expires_at,
         heartbeat_at = current_timestamp,
         ready = false,
         updated_at = current_timestamp
       WHERE message_delivery_leases.expires_at <= current_timestamp
          OR message_delivery_leases.owner_id = EXCLUDED.owner_id
       RETURNING fencing_token, expires_at`,
      [identity, ownerId, positiveInteger(leaseMs, 30_000)]
    );
    const row = result.rows[0];
    if (!result.rowCount || !row) return { acquired: false };
    return {
      acquired: true,
      fencingToken: Number(row.fencing_token),
      expiresAt: row.expires_at
    };
  }

  async function renewLease({ fencingToken, identity, leaseMs, ownerId }: DeliveryLease & { leaseMs?: unknown }):
    Promise<{ renewed: true; expiresAt: unknown } | { renewed: false }> {
    const result = await db.query<{ expires_at: unknown }>(
      `UPDATE message_delivery_leases
       SET expires_at = current_timestamp + ($4 * interval '1 millisecond'),
           heartbeat_at = current_timestamp, ready = true, updated_at = current_timestamp
       WHERE identity = $1 AND owner_id = $2 AND fencing_token = $3
         AND expires_at > current_timestamp
       RETURNING expires_at`,
      [identity, ownerId, fencingToken, positiveInteger(leaseMs, 30_000)]
    );
    const row = result.rows[0];
    return result.rowCount && row ? { renewed: true, expiresAt: row.expires_at } : { renewed: false };
  }

  async function releaseLease({ fencingToken, identity, ownerId }: DeliveryLease): Promise<void> {
    await db.query(
      `UPDATE message_delivery_leases
       SET expires_at = current_timestamp, ready = false, updated_at = current_timestamp
       WHERE identity = $1 AND owner_id = $2 AND fencing_token = $3`,
      [identity, ownerId, fencingToken]
    );
  }

  async function recordHeartbeat({ fencingToken, identity, ownerId, ready }: DeliveryLease & { ready?: unknown }): Promise<boolean> {
    const result = await db.query(
      `UPDATE message_delivery_leases
       SET heartbeat_at = current_timestamp, ready = $4, updated_at = current_timestamp
       WHERE identity = $1 AND owner_id = $2 AND fencing_token = $3
         AND expires_at > current_timestamp`,
      [identity, ownerId, fencingToken, Boolean(ready)]
    );
    return result.rowCount === 1;
  }

  async function claimBatch({
    fencingToken,
    identity,
    limit = DEFAULT_CLAIM_LIMIT,
    ownerId,
    staleClaimMs = DEFAULT_STALE_CLAIM_MS
  }: DeliveryLease & { limit?: unknown; staleClaimMs?: unknown }): Promise<OutboxEvent[]> {
    const result = await db.query<OutboxRow>(
      `WITH active_lease AS (
         SELECT 1 FROM message_delivery_leases
         WHERE identity = $1 AND owner_id = $2 AND fencing_token = $3
           AND expires_at > current_timestamp
       ), candidates AS (
         SELECT event_id
         FROM message_delivery_outbox
         WHERE (
           (status = 'pending' AND available_at <= current_timestamp)
           OR (status = 'processing' AND claimed_at <= current_timestamp - ($5 * interval '1 millisecond'))
         )
         ORDER BY available_at, created_at, event_id
         FOR UPDATE SKIP LOCKED
         LIMIT $4
       )
       UPDATE message_delivery_outbox AS outbox
       SET status = 'processing', attempts = attempts + 1, claimed_at = current_timestamp,
           claimed_fencing_token = $3, updated_at = current_timestamp
       FROM candidates, active_lease
       WHERE outbox.event_id = candidates.event_id
       RETURNING outbox.*`,
      [
        identity,
        ownerId,
        fencingToken,
        positiveInteger(limit, DEFAULT_CLAIM_LIMIT, 1_000),
        positiveInteger(staleClaimMs, DEFAULT_STALE_CLAIM_MS)
      ]
    );
    return result.rows.map(mapOutboxRow);
  }

  async function markDelivered(eventId: string, lease: DeliveryLease): Promise<void> {
    const result = await db.query(
      `UPDATE message_delivery_outbox AS outbox
       SET status = 'delivered', delivered_at = current_timestamp, claimed_at = NULL,
           claimed_fencing_token = NULL, last_error = NULL, updated_at = current_timestamp
       WHERE outbox.event_id = $1 AND outbox.status = 'processing'
         AND outbox.claimed_fencing_token = $4
         AND EXISTS (
           SELECT 1 FROM message_delivery_leases
           WHERE identity = $2 AND owner_id = $3 AND fencing_token = $4
             AND expires_at > current_timestamp
         )`,
      [eventId, lease.identity, lease.ownerId, lease.fencingToken]
    );
    if (!result.rowCount) throw new MessageDeliveryFenceError();
  }

  async function reschedule(eventId: string, lease: DeliveryLease, { delayMs, error, maxAttempts = 12 }: {
    delayMs?: unknown;
    error?: unknown;
    maxAttempts?: unknown;
  } = {}): Promise<void> {
    const message = String((error as { message?: unknown } | null | undefined)?.message || error || 'Message delivery failed').slice(0, 2_000);
    const result = await db.query(
      `UPDATE message_delivery_outbox AS outbox
       SET status = CASE WHEN attempts >= $6 THEN 'dead' ELSE 'pending' END,
           available_at = CASE WHEN attempts >= $6 THEN available_at ELSE current_timestamp + ($5 * interval '1 millisecond') END,
           dead_at = CASE WHEN attempts >= $6 THEN current_timestamp ELSE NULL END,
           claimed_at = NULL, claimed_fencing_token = NULL, last_error = $7,
           updated_at = current_timestamp
       WHERE outbox.event_id = $1 AND outbox.status = 'processing'
         AND outbox.claimed_fencing_token = $4
         AND EXISTS (
           SELECT 1 FROM message_delivery_leases
           WHERE identity = $2 AND owner_id = $3 AND fencing_token = $4
             AND expires_at > current_timestamp
         )`,
      [
        eventId,
        lease.identity,
        lease.ownerId,
        lease.fencingToken,
        positiveInteger(delayMs, 1_000, 60 * 60 * 1000),
        positiveInteger(maxAttempts, 12, 100),
        message
      ]
    );
    if (!result.rowCount) throw new MessageDeliveryFenceError();
  }

  async function publishPostgres(event: { eventId: string }, { channel = 'voice_room_message_delivery' }: { channel?: string } = {}): Promise<void> {
    if (!/^[a-z][a-z0-9_]{0,62}$/i.test(channel)) throw new TypeError('Invalid PostgreSQL notification channel');
    const payload = JSON.stringify({ eventId: event.eventId });
    await db.query('SELECT pg_notify($1, $2)', [channel, payload]);
  }

  async function getEvent(eventId: string): Promise<OutboxEvent | null> {
    const result = await db.query<OutboxRow>(
      `SELECT * FROM message_delivery_outbox WHERE event_id = $1 LIMIT 1`,
      [eventId]
    );
    return result.rows[0] ? mapOutboxRow(result.rows[0]) : null;
  }

  return Object.freeze({
    acquireLease,
    claimBatch,
    enqueue,
    getEvent,
    markDelivered,
    publishPostgres,
    recordHeartbeat,
    releaseLease,
    renewLease,
    reschedule
  });
}

export { DEFAULT_CLAIM_LIMIT, DEFAULT_STALE_CLAIM_MS, MessageDeliveryFenceError, createMessageOutboxRepository };
