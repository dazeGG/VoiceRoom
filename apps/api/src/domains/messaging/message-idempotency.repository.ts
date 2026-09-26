import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn } from '../../platform/db/kysely.ts';

const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ACTOR_QUOTA = 1_000;

type QueryClient = Pick<pg.PoolClient, 'query'>;

type Identity = {
  actorType: 'account' | 'guest';
  actorId: string;
  conversationType: 'room' | 'dm';
  conversationId: string;
  key: string;
  fingerprint: string;
};

type LedgerRow = {
  fingerprint: string;
  state: 'pending' | 'completed';
  message_id: string | null;
  response_status: number | string | null;
  response_body: unknown;
};

export type IdempotentReplay = Readonly<{ messageId: string | null; statusCode: number; body: unknown }>;
export type Reservation =
  | { kind: 'replay'; ledgerKey: string; response: IdempotentReplay }
  | { kind: 'pending'; ledgerKey: string }
  | { kind: 'reserved'; ledgerKey: string };

export type IdempotencyInput = {
  actorType?: unknown;
  actorId?: unknown;
  conversation?: { type?: unknown; id?: unknown } | null;
  key?: unknown;
  fingerprint?: unknown;
};

class IdempotencyConflictError extends Error {
  declare code: string;
  declare statusCode: number;

  constructor(message = 'Idempotency key was already used with a different request') {
    super(message);
    this.name = 'IdempotencyConflictError';
    this.code = 'IDEMPOTENCY_CONFLICT';
    this.statusCode = 409;
  }
}

class IdempotencyQuotaError extends Error {
  declare code: string;
  declare statusCode: number;

  constructor(message = 'Idempotency key quota exceeded') {
    super(message);
    this.name = 'IdempotencyQuotaError';
    this.code = 'IDEMPOTENCY_QUOTA_EXCEEDED';
    this.statusCode = 429;
  }
}

function requireQuery(client: unknown): asserts client is QueryClient {
  if (!client || typeof (client as QueryClient).query !== 'function') {
    throw new TypeError('An active PostgreSQL transaction client is required');
  }
}

function boundedString(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new TypeError(`${name} must be a non-empty string no longer than ${max} characters`);
  }
  return value;
}

function normalizeIdentity(input: IdempotencyInput = {}): Identity {
  const actorType = input.actorType === 'account' ? 'account' : input.actorType === 'guest' ? 'guest' : '';
  const conversationType = input.conversation?.type === 'room' ? 'room' : input.conversation?.type === 'dm' ? 'dm' : '';
  if (!actorType || !conversationType) throw new TypeError('Unsupported idempotency identity');

  return {
    actorType,
    actorId: boundedString(input.actorId, 'actorId', 160),
    conversationType,
    conversationId: boundedString(input.conversation?.id, 'conversation.id', 160),
    key: boundedString(input.key, 'key', 160),
    fingerprint: boundedString(input.fingerprint, 'fingerprint', 256)
  };
}

function encodeParts(parts: string[]): string {
  return parts.map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('|');
}

function ledgerKey(identity: Identity): string {
  return crypto
    .createHash('sha256')
    .update(
      encodeParts([
        identity.actorType,
        identity.actorId,
        identity.conversationType,
        identity.conversationId,
        identity.key
      ])
    )
    .digest('hex');
}

function actorLockKey(identity: Identity): string {
  return encodeParts([identity.actorType, identity.actorId]);
}

function rowToReplay(row: Pick<LedgerRow, 'message_id' | 'response_status' | 'response_body'>): IdempotentReplay {
  return Object.freeze({
    messageId: row.message_id || null,
    statusCode: Number(row.response_status),
    body: row.response_body
  });
}

function createMessageIdempotencyRepository({
  actorQuota = DEFAULT_ACTOR_QUOTA,
  retentionMs = DEFAULT_RETENTION_MS
}: { actorQuota?: number; retentionMs?: number } = {}) {
  if (!Number.isInteger(actorQuota) || actorQuota < 1) throw new TypeError('actorQuota must be a positive integer');
  if (!Number.isFinite(retentionMs) || retentionMs < 1_000)
    throw new TypeError('retentionMs must be at least one second');

  // Serialized per actor: expired keys are swept, a known key replays (or
  // conflicts on another request), a new one is reserved within the quota.
  async function reserve(client: unknown, input: IdempotencyInput): Promise<Reservation> {
    requireQuery(client);
    const db = kyselyOn(client);
    const identity = normalizeIdentity(input);
    const key = ledgerKey(identity);
    const ofActor = db
      .selectFrom('message_send_idempotency')
      .where('actor_type', '=', identity.actorType)
      .where('actor_id', '=', identity.actorId);

    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${actorLockKey(identity)}, 0))`.execute(db);
    await db
      .deleteFrom('message_send_idempotency')
      .where('actor_type', '=', identity.actorType)
      .where('actor_id', '=', identity.actorId)
      .where('expires_at', '<=', sql<Date>`current_timestamp`)
      .execute();

    const row = await db
      .selectFrom('message_send_idempotency')
      .select(['fingerprint', 'state', 'message_id', 'response_status', 'response_body'])
      .where('ledger_key', '=', key)
      .forUpdate()
      .executeTakeFirst();
    if (row) {
      if (row.fingerprint !== identity.fingerprint) throw new IdempotencyConflictError();
      if (row.state === 'completed') return { kind: 'replay', ledgerKey: key, response: rowToReplay(row) };
      return { kind: 'pending', ledgerKey: key };
    }

    const count = await ofActor
      .select(sql<number>`count(*)::integer`.as('count'))
      .where('expires_at', '>', sql<Date>`current_timestamp`)
      .executeTakeFirst();
    if (Number(count?.count || 0) >= actorQuota) throw new IdempotencyQuotaError();

    await db
      .insertInto('message_send_idempotency')
      .values({
        ledger_key: key,
        actor_type: identity.actorType,
        actor_id: identity.actorId,
        conversation_type: identity.conversationType,
        conversation_id: identity.conversationId,
        idempotency_key: identity.key,
        fingerprint: identity.fingerprint,
        expires_at: sql<Date>`current_timestamp + (${retentionMs} * interval '1 millisecond')`
      })
      .execute();
    return { kind: 'reserved', ledgerKey: key };
  }

  async function complete(
    client: unknown,
    key: unknown,
    {
      body,
      messageId = null,
      statusCode = 200
    }: {
      body?: unknown;
      messageId?: string | null;
      statusCode?: number;
    } = {}
  ): Promise<IdempotentReplay> {
    requireQuery(client);
    const ledger = boundedString(key, 'ledgerKey', 64);
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      throw new TypeError('statusCode must be a valid HTTP status');
    }
    if (body === undefined) throw new TypeError('An idempotent response body is required');
    if (messageId !== null) boundedString(messageId, 'messageId', 160);

    const row = await kyselyOn(client)
      .updateTable('message_send_idempotency')
      .set({
        state: 'completed',
        message_id: messageId,
        response_status: statusCode,
        response_body: JSON.stringify(body),
        completed_at: sql<Date>`current_timestamp`
      })
      .where('ledger_key', '=', ledger)
      .where('state', '=', 'pending')
      .returning(['message_id', 'response_status', 'response_body'])
      .executeTakeFirst();
    if (!row) throw new Error('Idempotency reservation is missing or already completed');
    return rowToReplay(row);
  }

  async function pruneExpired(client: unknown, { limit = 500 }: { limit?: unknown } = {}): Promise<number | null> {
    requireQuery(client);
    const boundedLimit = Math.max(1, Math.min(5_000, Number.parseInt(limit as string, 10) || 500));
    const result = await kyselyOn(client)
      .deleteFrom('message_send_idempotency')
      .where('ledger_key', 'in', (eb) =>
        eb
          .selectFrom('message_send_idempotency')
          .select('ledger_key')
          .where('expires_at', '<=', sql<Date>`current_timestamp`)
          .orderBy('expires_at')
          .limit(boundedLimit)
      )
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  return Object.freeze({ complete, pruneExpired, reserve });
}

export {
  DEFAULT_ACTOR_QUOTA,
  DEFAULT_RETENTION_MS,
  IdempotencyConflictError,
  IdempotencyQuotaError,
  createMessageIdempotencyRepository
};
