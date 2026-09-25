import crypto from 'node:crypto';
import type pg from 'pg';

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

  async function reserve(client: unknown, input: IdempotencyInput): Promise<Reservation> {
    requireQuery(client);
    const identity = normalizeIdentity(input);
    const key = ledgerKey(identity);

    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [actorLockKey(identity)]);
    await client.query(
      `DELETE FROM message_send_idempotency
       WHERE actor_type = $1 AND actor_id = $2 AND expires_at <= current_timestamp`,
      [identity.actorType, identity.actorId]
    );

    const existing = await client.query<LedgerRow>(
      `SELECT fingerprint, state, message_id, response_status, response_body
       FROM message_send_idempotency
       WHERE ledger_key = $1
       FOR UPDATE`,
      [key]
    );
    const row = existing.rows[0];
    if (existing.rowCount && row) {
      if (row.fingerprint !== identity.fingerprint) throw new IdempotencyConflictError();
      if (row.state === 'completed') return { kind: 'replay', ledgerKey: key, response: rowToReplay(row) };
      return { kind: 'pending', ledgerKey: key };
    }

    const count = await client.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM message_send_idempotency
       WHERE actor_type = $1 AND actor_id = $2 AND expires_at > current_timestamp`,
      [identity.actorType, identity.actorId]
    );
    if (Number(count.rows[0]?.count || 0) >= actorQuota) throw new IdempotencyQuotaError();

    await client.query(
      `INSERT INTO message_send_idempotency (
         ledger_key, actor_type, actor_id, conversation_type, conversation_id,
         idempotency_key, fingerprint, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, current_timestamp + ($8 * interval '1 millisecond'))`,
      [
        key,
        identity.actorType,
        identity.actorId,
        identity.conversationType,
        identity.conversationId,
        identity.key,
        identity.fingerprint,
        retentionMs
      ]
    );
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
    boundedString(key, 'ledgerKey', 64);
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
      throw new TypeError('statusCode must be a valid HTTP status');
    }
    if (body === undefined) throw new TypeError('An idempotent response body is required');
    if (messageId !== null) boundedString(messageId, 'messageId', 160);

    const result = await client.query<Pick<LedgerRow, 'message_id' | 'response_status' | 'response_body'>>(
      `UPDATE message_send_idempotency
       SET state = 'completed', message_id = $2, response_status = $3,
           response_body = $4::jsonb, completed_at = current_timestamp
       WHERE ledger_key = $1 AND state = 'pending'
       RETURNING message_id, response_status, response_body`,
      [key, messageId, statusCode, JSON.stringify(body)]
    );
    const row = result.rows[0];
    if (!result.rowCount || !row) throw new Error('Idempotency reservation is missing or already completed');
    return rowToReplay(row);
  }

  async function pruneExpired(client: unknown, { limit = 500 }: { limit?: unknown } = {}): Promise<number | null> {
    requireQuery(client);
    const boundedLimit = Math.max(1, Math.min(5_000, Number.parseInt(limit as string, 10) || 500));
    const result = await client.query(
      `DELETE FROM message_send_idempotency
       WHERE ledger_key IN (
         SELECT ledger_key FROM message_send_idempotency
         WHERE expires_at <= current_timestamp
         ORDER BY expires_at
         LIMIT $1
       )`,
      [boundedLimit]
    );
    return result.rowCount;
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
