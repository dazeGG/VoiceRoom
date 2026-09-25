import crypto from 'node:crypto';
import type pg from 'pg';

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

function createNotificationOutboxRepository({ pool }: { pool?: QueryClient | null } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  const defaultDb = pool;
  const db = (client: Client): QueryClient => (client?.query ? client : defaultDb);

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
    const r = await db(client).query<OutboxRow>(
      `INSERT INTO notification_outbox(event_id,notification_id,recipient_user_id,revision,channel,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(notification_id,revision,channel) DO UPDATE SET payload=EXCLUDED.payload WHERE notification_outbox.status='pending' RETURNING *`,
      [eventId, notificationId, recipientUserId, revision, channel, JSON.stringify(payload)]
    );
    return mapRow(r.rows[0]);
  }

  async function acquireLease({
    identity,
    ownerId,
    leaseMs
  }: {
    identity: string;
    ownerId: string;
    leaseMs: number;
  }): Promise<{ acquired: true; fencingToken: number; expiresAt: unknown } | { acquired: false }> {
    const r = await defaultDb.query<{ fencing_token: string | number; expires_at: unknown }>(
      `INSERT INTO notification_delivery_leases(identity,owner_id,fencing_token,expires_at,updated_at) VALUES($1,$2,1,current_timestamp+($3*interval '1 millisecond'),current_timestamp) ON CONFLICT(identity) DO UPDATE SET owner_id=EXCLUDED.owner_id,fencing_token=notification_delivery_leases.fencing_token+1,expires_at=EXCLUDED.expires_at,updated_at=current_timestamp WHERE notification_delivery_leases.expires_at<=current_timestamp OR notification_delivery_leases.owner_id=$2 RETURNING fencing_token,expires_at`,
      [identity, ownerId, leaseMs]
    );
    const row = r.rows[0];
    return row
      ? { acquired: true, fencingToken: Number(row.fencing_token), expiresAt: row.expires_at }
      : { acquired: false };
  }

  async function renewLease({
    identity,
    ownerId,
    fencingToken,
    leaseMs
  }: NotificationLease & { leaseMs: number }): Promise<{ renewed: boolean }> {
    const r = await defaultDb.query(
      `UPDATE notification_delivery_leases SET expires_at=current_timestamp+($4*interval '1 millisecond'),heartbeat_at=current_timestamp,updated_at=current_timestamp WHERE identity=$1 AND owner_id=$2 AND fencing_token=$3 AND expires_at>current_timestamp`,
      [identity, ownerId, fencingToken, leaseMs]
    );
    return { renewed: r.rowCount === 1 };
  }

  async function releaseLease({ identity, ownerId, fencingToken }: NotificationLease): Promise<void> {
    await defaultDb.query(
      `UPDATE notification_delivery_leases SET expires_at='-infinity',ready=false,updated_at=current_timestamp WHERE identity=$1 AND owner_id=$2 AND fencing_token=$3`,
      [identity, ownerId, fencingToken]
    );
  }

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
    await defaultDb.query(
      `INSERT INTO notification_delivery_leases(identity,owner_id,fencing_token,expires_at,heartbeat_at,ready) VALUES($1,$2,$3,'-infinity',current_timestamp,$4) ON CONFLICT(identity) DO UPDATE SET heartbeat_at=current_timestamp,ready=$4,updated_at=current_timestamp WHERE notification_delivery_leases.fencing_token<=$3`,
      [identity, ownerId, fencingToken, ready]
    );
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
    const r = await defaultDb.query<OutboxRow>(
      `WITH fence AS (SELECT 1 FROM notification_delivery_leases WHERE identity=$1 AND owner_id=$2 AND fencing_token=$3 AND expires_at>current_timestamp), candidates AS (SELECT event_id FROM notification_outbox,fence WHERE (status='pending' AND available_at<=current_timestamp) OR (status='processing' AND claimed_at<current_timestamp-($5*interval '1 millisecond')) ORDER BY available_at,created_at,event_id FOR UPDATE OF notification_outbox SKIP LOCKED LIMIT $4) UPDATE notification_outbox o SET status='processing',claimed_at=current_timestamp,claimed_fencing_token=$3,attempts=o.attempts+1,updated_at=current_timestamp FROM candidates WHERE o.event_id=candidates.event_id RETURNING o.*`,
      [identity, ownerId, fencingToken, limit, staleClaimMs]
    );
    return r.rows.map(mapRow) as NotificationOutboxEvent[];
  }

  async function finish(eventId: string, lease: NotificationLease, status: string, extra = ''): Promise<void> {
    const r = await defaultDb.query(
      `UPDATE notification_outbox o SET status=$5, ${extra || "delivered_at=CASE WHEN $5='delivered' THEN current_timestamp ELSE delivered_at END"}, updated_at=current_timestamp FROM notification_delivery_leases l WHERE o.event_id=$1 AND o.claimed_fencing_token=$4 AND l.identity=$2 AND l.owner_id=$3 AND l.fencing_token=$4 AND l.expires_at>current_timestamp`,
      [eventId, lease.identity, lease.ownerId, lease.fencingToken, status]
    );
    if (!r.rowCount) throw new NotificationFenceError();
  }

  const markDelivered = (id: string, lease: NotificationLease): Promise<void> => finish(id, lease, 'delivered');
  const markSuppressed = (id: string, lease: NotificationLease): Promise<void> =>
    finish(id, lease, 'suppressed', 'suppressed_at=current_timestamp');

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
    const r = await defaultDb.query(
      `UPDATE notification_outbox o SET status=CASE WHEN attempts >= $5 THEN 'dead' ELSE 'pending' END, dead_at=CASE WHEN attempts >= $5 THEN current_timestamp ELSE dead_at END, available_at=current_timestamp+($6*interval '1 millisecond'),last_error=$7,claimed_at=NULL,claimed_fencing_token=NULL,updated_at=current_timestamp FROM notification_delivery_leases l WHERE o.event_id=$1 AND o.claimed_fencing_token=$4 AND l.identity=$2 AND l.owner_id=$3 AND l.fencing_token=$4 AND l.expires_at>current_timestamp`,
      [
        eventId,
        lease.identity,
        lease.ownerId,
        lease.fencingToken,
        maxAttempts,
        delayMs,
        String((error as { message?: unknown } | null | undefined)?.message || error || 'delivery failed').slice(
          0,
          2000
        )
      ]
    );
    if (!r.rowCount) throw new NotificationFenceError();
  }

  async function loadCurrent(
    event: { eventId: string },
    { client }: { client?: Client } = {}
  ): Promise<Record<string, unknown> | null> {
    const r = await db(client).query(
      `SELECT o.*,n.read_at,n.retracted_at,n.reasons,np.private_notifications,u.dnd,coalesce(nrm.level,'mentions') level FROM notification_outbox o JOIN user_notifications n ON n.id=o.notification_id JOIN users u ON u.id=n.recipient_user_id LEFT JOIN notification_preferences np ON np.user_id=n.recipient_user_id LEFT JOIN notification_room_mutes nrm ON nrm.user_id=n.recipient_user_id AND nrm.room_id=n.room_id WHERE o.event_id=$1`,
      [event.eventId]
    );
    return r.rows[0] || null;
  }

  async function oldestPendingAgeMs(): Promise<number> {
    const r = await defaultDb.query<{ age_ms: string | number | null }>(
      `SELECT COALESCE(EXTRACT(EPOCH FROM (current_timestamp-MIN(created_at)))*1000,0)::bigint AS age_ms FROM notification_outbox WHERE status IN ('pending','processing')`
    );
    return Number(r.rows[0]?.age_ms || 0);
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
