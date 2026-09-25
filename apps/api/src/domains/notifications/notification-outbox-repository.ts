import crypto from 'node:crypto';
import { sql } from 'kysely';
import type pg from 'pg';
import { kyselyOn, type Database } from '../../platform/db/kysely.ts';

type QueryClient = Pick<pg.PoolClient, 'query'>;
type Client = QueryClient | null | undefined;

type OutboxRow = {
  event_id: string;
  notification_id: string;
  recipient_user_id: string;
  revision: number | string;
  channel: string;
  payload: unknown;
  status: string;
  attempts: number | string;
  created_at: unknown;
};

export type NotificationOutboxEvent = {
  eventId: string;
  notificationId: string;
  recipientUserId: string;
  revision: number;
  channel: string;
  payload: unknown;
  status: string;
  attempts: number;
  createdAt: unknown;
};

export type NotificationLease = { identity: string; ownerId: string; fencingToken: number };

class NotificationFenceError extends Error {
  declare code: string;

  constructor() {
    super('Notification delivery fence lost');
    this.code = 'NOTIFICATION_FENCE_LOST';
  }
}

function mapRow(row: OutboxRow | null | undefined): NotificationOutboxEvent | null {
  return row
    ? {
        eventId: row.event_id,
        notificationId: row.notification_id,
        recipientUserId: row.recipient_user_id,
        revision: Number(row.revision),
        channel: row.channel,
        payload: row.payload,
        status: row.status,
        attempts: Number(row.attempts),
        createdAt: row.created_at
      }
    : null;
}

const now = sql<Date>`current_timestamp`;
const after = (ms: number) => sql<Date>`current_timestamp + (${ms} * interval '1 millisecond')`;
const never = sql<Date>`'-infinity'`;

function createNotificationOutboxRepository({ pool }: { pool?: QueryClient | null } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  const base = kyselyOn(pool);
  const on = (client: Client): Database => (client?.query ? kyselyOn(client) : base);

  // One event per notification revision and channel; a pending one takes the
  // newest payload.
  async function enqueue({
    notificationId,
    recipientUserId,
    revision,
    payload,
    channel = 'web_push',
    client
  }: {
    notificationId: string;
    recipientUserId: string;
    revision: number;
    payload: unknown;
    channel?: string;
    client?: Client;
  }): Promise<NotificationOutboxEvent | null> {
    const eventId = crypto.createHash('sha256').update(`${notificationId}:${revision}:${channel}`).digest('hex');
    const row = await on(client)
      .insertInto('notification_outbox')
      .values({
        event_id: eventId,
        notification_id: notificationId,
        recipient_user_id: recipientUserId,
        revision,
        channel,
        payload: JSON.stringify(payload)
      })
      .onConflict((oc) =>
        oc
          .columns(['notification_id', 'revision', 'channel'])
          .doUpdateSet((eb) => ({ payload: eb.ref('excluded.payload') }))
          .where('notification_outbox.status', '=', 'pending')
      )
      .returningAll()
      .executeTakeFirst();
    return mapRow(row);
  }

  // Taken when free or expired, or re-taken by its owner; each moves the fence.
  async function acquireLease({
    identity,
    ownerId,
    leaseMs
  }: {
    identity: string;
    ownerId: string;
    leaseMs: number;
  }): Promise<{ acquired: true; fencingToken: number; expiresAt: unknown } | { acquired: false }> {
    const row = await base
      .insertInto('notification_delivery_leases')
      .values({ identity, owner_id: ownerId, fencing_token: 1, expires_at: after(leaseMs), updated_at: now })
      .onConflict((oc) =>
        oc
          .column('identity')
          .doUpdateSet((eb) => ({
            owner_id: eb.ref('excluded.owner_id'),
            fencing_token: sql<string>`notification_delivery_leases.fencing_token + 1`,
            expires_at: eb.ref('excluded.expires_at'),
            updated_at: now
          }))
          .where((eb) =>
            eb.or([
              eb('notification_delivery_leases.expires_at', '<=', now),
              eb('notification_delivery_leases.owner_id', '=', ownerId)
            ])
          )
      )
      .returning(['fencing_token', 'expires_at'])
      .executeTakeFirst();
    return row
      ? { acquired: true, fencingToken: Number(row.fencing_token), expiresAt: row.expires_at }
      : { acquired: false };
  }

  function ownLease({ identity, ownerId, fencingToken }: NotificationLease) {
    return base
      .updateTable('notification_delivery_leases')
      .where('identity', '=', identity)
      .where('owner_id', '=', ownerId)
      .where('fencing_token', '=', String(fencingToken));
  }

  async function renewLease({
    leaseMs,
    ...lease
  }: NotificationLease & { leaseMs: number }): Promise<{ renewed: boolean }> {
    const result = await ownLease(lease)
      .set({ expires_at: after(leaseMs), heartbeat_at: now, updated_at: now })
      .where('expires_at', '>', now)
      .executeTakeFirst();
    return { renewed: result.numUpdatedRows === 1n };
  }

  async function releaseLease(lease: NotificationLease): Promise<void> {
    await ownLease(lease).set({ expires_at: never, ready: false, updated_at: now }).execute();
  }

  // Readiness is reported whether or not the worker holds the lease, but never
  // by a worker behind the current fence.
  async function recordHeartbeat({
    identity,
    ownerId = null,
    fencingToken = 0,
    ready = false
  }: {
    identity: string;
    ownerId?: string | null;
    fencingToken?: number;
    ready?: boolean;
  }): Promise<void> {
    await base
      .insertInto('notification_delivery_leases')
      .values({ identity, owner_id: ownerId, fencing_token: fencingToken, expires_at: never, heartbeat_at: now, ready })
      .onConflict((oc) =>
        oc
          .column('identity')
          .doUpdateSet({ heartbeat_at: now, ready, updated_at: now })
          .where('notification_delivery_leases.fencing_token', '<=', String(fencingToken))
      )
      .execute();
  }

  async function claimBatch({
    identity,
    ownerId,
    fencingToken,
    limit = 50,
    staleClaimMs = 120000
  }: NotificationLease & {
    limit?: number;
    staleClaimMs?: number;
  }): Promise<NotificationOutboxEvent[]> {
    const rows = await base
      .with('fence', (qb) =>
        qb
          .selectFrom('notification_delivery_leases')
          .select('identity')
          .where('identity', '=', identity)
          .where('owner_id', '=', ownerId)
          .where('fencing_token', '=', String(fencingToken))
          .where('expires_at', '>', now)
      )
      .with('candidates', (qb) =>
        qb
          .selectFrom(['notification_outbox', 'fence'])
          .select('notification_outbox.event_id')
          .where((eb) =>
            eb.or([
              eb.and([eb('status', '=', 'pending'), eb('available_at', '<=', now)]),
              eb.and([
                eb('status', '=', 'processing'),
                eb('claimed_at', '<', sql<Date>`current_timestamp - (${staleClaimMs} * interval '1 millisecond')`)
              ])
            ])
          )
          .orderBy('available_at')
          .orderBy('created_at')
          .orderBy('notification_outbox.event_id')
          .forUpdate(['notification_outbox'])
          .skipLocked()
          .limit(limit)
      )
      .updateTable('notification_outbox as o')
      .from('candidates')
      .set((eb) => ({
        status: 'processing',
        claimed_at: now,
        claimed_fencing_token: String(fencingToken),
        attempts: eb('o.attempts', '+', 1),
        updated_at: now
      }))
      .whereRef('o.event_id', '=', 'candidates.event_id')
      .returningAll('o')
      .execute();
    return rows.map((row) => mapRow(row as OutboxRow) as NotificationOutboxEvent);
  }

  // Only the worker holding the lease the event was claimed under may settle it.
  function settle(eventId: string, lease: NotificationLease) {
    return base
      .updateTable('notification_outbox as o')
      .from('notification_delivery_leases as l')
      .where('o.event_id', '=', eventId)
      .where('o.claimed_fencing_token', '=', String(lease.fencingToken))
      .where('l.identity', '=', lease.identity)
      .where('l.owner_id', '=', lease.ownerId)
      .where('l.fencing_token', '=', String(lease.fencingToken))
      .where('l.expires_at', '>', now);
  }

  async function markDelivered(eventId: string, lease: NotificationLease): Promise<void> {
    const result = await settle(eventId, lease)
      .set({ status: 'delivered', delivered_at: now, updated_at: now })
      .executeTakeFirst();
    if (!result.numUpdatedRows) throw new NotificationFenceError();
  }

  async function markSuppressed(eventId: string, lease: NotificationLease): Promise<void> {
    const result = await settle(eventId, lease)
      .set({ status: 'suppressed', suppressed_at: now, updated_at: now })
      .executeTakeFirst();
    if (!result.numUpdatedRows) throw new NotificationFenceError();
  }

  async function reschedule(
    eventId: string,
    lease: NotificationLease,
    {
      delayMs,
      error,
      maxAttempts = 8
    }: {
      delayMs?: number;
      error?: unknown;
      maxAttempts?: number;
    } = {}
  ): Promise<void> {
    const reason = (error as { message?: unknown } | null | undefined)?.message || error || 'delivery failed';
    const exhausted = sql<boolean>`o.attempts >= ${maxAttempts}`;
    const result = await settle(eventId, lease)
      .set({
        status: sql<string>`CASE WHEN ${exhausted} THEN 'dead' ELSE 'pending' END`,
        dead_at: sql<Date | null>`CASE WHEN ${exhausted} THEN current_timestamp ELSE o.dead_at END`,
        available_at: after(delayMs as number),
        last_error: (typeof reason === 'string' ? reason : 'delivery failed').slice(0, 2000),
        claimed_at: null,
        claimed_fencing_token: null,
        updated_at: now
      })
      .executeTakeFirst();
    if (!result.numUpdatedRows) throw new NotificationFenceError();
  }

  // The event with the recipient's current state, so a notification read,
  // retracted or silenced since it was queued is not pushed.
  async function loadCurrent(
    event: { eventId: string },
    { client }: { client?: Client } = {}
  ): Promise<Record<string, unknown> | null> {
    const row = await on(client)
      .selectFrom('notification_outbox as o')
      .innerJoin('user_notifications as n', 'n.id', 'o.notification_id')
      .innerJoin('users as u', 'u.id', 'n.recipient_user_id')
      .leftJoin('notification_preferences as np', 'np.user_id', 'n.recipient_user_id')
      .leftJoin('notification_room_mutes as nrm', (join) =>
        join.onRef('nrm.user_id', '=', 'n.recipient_user_id').onRef('nrm.room_id', '=', 'n.room_id')
      )
      .selectAll('o')
      .select([
        'n.read_at',
        'n.retracted_at',
        'n.reasons',
        'np.private_notifications',
        'u.dnd',
        sql<string>`coalesce(nrm.level, 'mentions')`.as('level')
      ])
      .where('o.event_id', '=', event.eventId)
      .executeTakeFirst();
    return row || null;
  }

  async function oldestPendingAgeMs(): Promise<number> {
    const row = await base
      .selectFrom('notification_outbox')
      .select(
        sql<string>`COALESCE(EXTRACT(EPOCH FROM (current_timestamp - MIN(created_at))) * 1000, 0)::bigint`.as('age_ms')
      )
      .where('status', 'in', ['pending', 'processing'])
      .executeTakeFirst();
    return Number(row?.age_ms || 0);
  }

  return {
    acquireLease,
    claimBatch,
    enqueue,
    loadCurrent,
    markDelivered,
    markSuppressed,
    oldestPendingAgeMs,
    recordHeartbeat,
    releaseLease,
    renewLease,
    reschedule
  };
}

export type NotificationOutboxRepository = ReturnType<typeof createNotificationOutboxRepository>;

export { NotificationFenceError, createNotificationOutboxRepository };
