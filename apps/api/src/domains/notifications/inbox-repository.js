'use strict';

const crypto = require('node:crypto');
const { transaction } = require('../../lib/db');

function dbFor(pool, client) { return client?.query ? client : pool; }
function mapRow(row) { return row ? { id: row.id, recipientUserId: row.recipient_user_id, actorUserId: row.actor_user_id, roomId: row.room_id, sourceMessageId: row.source_message_id, reasons: row.reasons || [], body: row.body || '', revision: Number(row.revision), readAt: row.read_at, retractedAt: row.retracted_at, createdAt: row.created_at, updatedAt: row.updated_at, cursorTuple: { createdAtMicros: String(row.created_at_micros || Math.trunc(new Date(row.created_at).getTime() * 1000)), id: row.id } } : null; }

function createInboxRepository({ pool } = {}) {
  if (!pool?.query) throw new TypeError('A PostgreSQL pool is required');
  function mutate(client, callback) { return client?.query ? callback(client) : transaction(pool, callback); }
  async function allocateRevision(db, recipientUserId) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('voice-room:notification-revision:' || $1))`, [recipientUserId]);
    const result = await db.query(`SELECT coalesce(max(revision),0)+1 AS revision FROM user_notifications WHERE recipient_user_id=$1`, [recipientUserId]);
    return Number(result.rows[0].revision);
  }
  async function upsert({ recipientUserId, actorUserId, roomId, sourceMessageId, reasons, body = '', client } = {}) {
    return mutate(client, async (db) => {
      const revision = await allocateRevision(db, recipientUserId);
      const result = await db.query(
        `INSERT INTO user_notifications (id,recipient_user_id,actor_user_id,room_id,source_message_id,reasons,body,revision)
       VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8)
       ON CONFLICT (recipient_user_id, source_message_id) DO UPDATE SET
         reasons=(SELECT ARRAY(SELECT DISTINCT unnest(user_notifications.reasons || EXCLUDED.reasons) ORDER BY 1)),
         actor_user_id=EXCLUDED.actor_user_id, body=EXCLUDED.body, retracted_at=NULL,
         revision=CASE WHEN user_notifications.retracted_at IS NOT NULL OR user_notifications.reasons IS DISTINCT FROM (SELECT ARRAY(SELECT DISTINCT unnest(user_notifications.reasons || EXCLUDED.reasons) ORDER BY 1)) OR user_notifications.body IS DISTINCT FROM EXCLUDED.body THEN EXCLUDED.revision ELSE user_notifications.revision END,
         updated_at=current_timestamp RETURNING *`,
        [crypto.randomUUID(), recipientUserId, actorUserId, roomId, sourceMessageId, reasons, body, revision]
      );
      return mapRow(result.rows[0]);
    });
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
  async function markRead({ recipientUserId, notificationId, client } = {}) { return mutate(client,async(db)=>{const revision=await allocateRevision(db,recipientUserId);const r=await db.query(`UPDATE user_notifications SET read_at=coalesce(read_at,current_timestamp),revision=CASE WHEN read_at IS NULL THEN $3 ELSE revision END,updated_at=CASE WHEN read_at IS NULL THEN current_timestamp ELSE updated_at END WHERE id=$1 AND recipient_user_id=$2 RETURNING *`,[notificationId,recipientUserId,revision]);return mapRow(r.rows[0]);}); }
  async function markAllRead({ recipientUserId, through = null, client } = {}) { return mutate(client,async(db)=>{const revision=await allocateRevision(db,recipientUserId);const r=await db.query(`UPDATE user_notifications SET read_at=current_timestamp,revision=$3,updated_at=current_timestamp WHERE recipient_user_id=$1 AND read_at IS NULL AND ($2::timestamptz IS NULL OR created_at <= $2)`,[recipientUserId,through,revision]);return {updated:r.rowCount,revision:r.rowCount?revision:null};}); }
  async function retractByMessage(sourceMessageId,{client}={}) { return mutate(client,async(db)=>{const recipients=await db.query(`SELECT DISTINCT recipient_user_id FROM user_notifications WHERE source_message_id=$1 AND retracted_at IS NULL ORDER BY recipient_user_id`,[sourceMessageId]);const rows=[];for(const {recipient_user_id:recipientUserId} of recipients.rows){const revision=await allocateRevision(db,recipientUserId);const r=await db.query(`UPDATE user_notifications SET retracted_at=current_timestamp,body='',revision=$3,updated_at=current_timestamp WHERE source_message_id=$1 AND recipient_user_id=$2 AND retracted_at IS NULL RETURNING *`,[sourceMessageId,recipientUserId,revision]);rows.push(...r.rows);}return rows.map(mapRow);}); }
  // Reading the message is reading its notification. Without this the bell kept
  // its badge over messages the reader had already seen, and a reload brought it
  // straight back because nothing had ever been written down.
  async function markReadForRoom({ recipientUserId, roomId, through = null, client } = {}) { return mutate(client,async(db)=>{const revision=await allocateRevision(db,recipientUserId);const r=await db.query(`UPDATE user_notifications SET read_at=current_timestamp,revision=$4,updated_at=current_timestamp WHERE recipient_user_id=$1 AND room_id=$2 AND read_at IS NULL AND ($3::timestamptz IS NULL OR created_at <= $3)`,[recipientUserId,roomId,through,revision]);return {updated:r.rowCount,revision:r.rowCount?revision:null};}); }
  return { findFirstUnread, list, markAllRead, markRead, markReadForRoom, retractByMessage, unreadCount, upsert };
}

module.exports = { createInboxRepository, mapNotificationRow: mapRow };
