'use strict';

const crypto = require('node:crypto');

function dbFor(pool, client) { return client?.query ? client : pool; }
function mapRow(row) { return row ? { id: row.id, recipientUserId: row.recipient_user_id, actorUserId: row.actor_user_id, roomId: row.room_id, sourceMessageId: row.source_message_id, reasons: row.reasons || [], body: row.body || '', revision: Number(row.revision), readAt: row.read_at, retractedAt: row.retracted_at, createdAt: row.created_at, updatedAt: row.updated_at, cursorTuple: { createdAtMicros: String(row.created_at_micros || Math.trunc(new Date(row.created_at).getTime() * 1000)), id: row.id } } : null; }

function createInboxRepository({ pool } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  async function upsert({ recipientUserId, actorUserId, roomId, sourceMessageId, reasons, body = '', client } = {}) {
    const result = await dbFor(pool, client).query(
      `WITH fence AS (
         SELECT pg_advisory_xact_lock(hashtext('voice-room:notification-revision:' || $2))
       ), next_revision AS (
         SELECT coalesce(max(revision),0)+1 AS revision FROM user_notifications,fence WHERE recipient_user_id=$2
       )
       INSERT INTO user_notifications (id,recipient_user_id,actor_user_id,room_id,source_message_id,reasons,body,revision)
       SELECT $1,$2,$3,$4,$5,$6::text[],$7,next_revision.revision FROM next_revision
       ON CONFLICT (recipient_user_id, source_message_id) DO UPDATE SET
         reasons=(SELECT ARRAY(SELECT DISTINCT unnest(user_notifications.reasons || EXCLUDED.reasons) ORDER BY 1)),
         actor_user_id=EXCLUDED.actor_user_id, body=EXCLUDED.body, retracted_at=NULL,
         revision=CASE WHEN user_notifications.retracted_at IS NOT NULL OR user_notifications.reasons IS DISTINCT FROM (SELECT ARRAY(SELECT DISTINCT unnest(user_notifications.reasons || EXCLUDED.reasons) ORDER BY 1)) OR user_notifications.body IS DISTINCT FROM EXCLUDED.body THEN EXCLUDED.revision ELSE user_notifications.revision END,
         updated_at=current_timestamp RETURNING *`,
      [crypto.randomUUID(), recipientUserId, actorUserId, roomId, sourceMessageId, reasons, body]
    ); return mapRow(result.rows[0]);
  }
  async function list({ recipientUserId, limit = 50, before = null, client } = {}) {
    const result = await dbFor(pool, client).query(
      `SELECT *, floor(extract(epoch FROM created_at)*1000000)::numeric(20,0) created_at_micros
       FROM user_notifications WHERE recipient_user_id=$1
         AND ($2::numeric IS NULL OR (created_at,id)<(to_timestamp($2::numeric/1000000.0),$3::varchar))
       ORDER BY created_at DESC,id DESC LIMIT $4`,
      [recipientUserId, before?.createdAtMicros || null, before?.id || '', Math.min(101, limit + 1)]
    ); return result.rows.map(mapRow);
  }
  async function findFirstUnread(recipientUserId, { client } = {}) { const r=await dbFor(pool,client).query(`SELECT *,floor(extract(epoch FROM created_at)*1000000)::numeric(20,0) created_at_micros FROM user_notifications WHERE recipient_user_id=$1 AND read_at IS NULL AND retracted_at IS NULL ORDER BY created_at ASC,id ASC LIMIT 1`,[recipientUserId]); return mapRow(r.rows[0]); }
  async function unreadCount(recipientUserId, { client } = {}) { const r=await dbFor(pool,client).query(`SELECT count(*) FILTER (WHERE read_at IS NULL AND retracted_at IS NULL)::int count,coalesce(max(revision),0)::bigint revision FROM user_notifications WHERE recipient_user_id=$1`,[recipientUserId]); return { count:Number(r.rows[0]?.count||0), revision:Number(r.rows[0]?.revision||0) }; }
  async function markRead({ recipientUserId, notificationId, client } = {}) { const r=await dbFor(pool,client).query(`WITH fence AS (SELECT pg_advisory_xact_lock(hashtext('voice-room:notification-revision:'||$2))),next_revision AS (SELECT coalesce(max(revision),0)+1 revision FROM user_notifications,fence WHERE recipient_user_id=$2) UPDATE user_notifications SET read_at=coalesce(read_at,current_timestamp),revision=CASE WHEN read_at IS NULL THEN next_revision.revision ELSE user_notifications.revision END,updated_at=CASE WHEN read_at IS NULL THEN current_timestamp ELSE updated_at END FROM next_revision WHERE id=$1 AND recipient_user_id=$2 RETURNING user_notifications.*`,[notificationId,recipientUserId]); return mapRow(r.rows[0]); }
  async function markAllRead({ recipientUserId, through = null, client } = {}) { const r=await dbFor(pool,client).query(`WITH fence AS (SELECT pg_advisory_xact_lock(hashtext('voice-room:notification-revision:'||$1))),next_revision AS (SELECT coalesce(max(revision),0)+1 revision FROM user_notifications,fence WHERE recipient_user_id=$1) UPDATE user_notifications SET read_at=current_timestamp,revision=next_revision.revision,updated_at=current_timestamp FROM next_revision WHERE recipient_user_id=$1 AND read_at IS NULL AND ($2::timestamptz IS NULL OR created_at <= $2)`,[recipientUserId,through]); return r.rowCount; }
  async function retractByMessage(sourceMessageId,{client}={}) { const r=await dbFor(pool,client).query(`UPDATE user_notifications SET retracted_at=coalesce(retracted_at,current_timestamp),body='',revision=greatest(revision+1,floor(extract(epoch FROM clock_timestamp())*1000000)::bigint),updated_at=current_timestamp WHERE source_message_id=$1 AND retracted_at IS NULL RETURNING *`,[sourceMessageId]); return r.rows.map(mapRow); }
  return { findFirstUnread, list, markAllRead, markRead, retractByMessage, unreadCount, upsert };
}

module.exports = { createInboxRepository, mapNotificationRow: mapRow };
