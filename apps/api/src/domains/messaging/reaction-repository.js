'use strict';

const CONTEXT_TABLES = Object.freeze({
  room: Object.freeze({
    reactions: 'room_message_reactions',
    revisions: 'room_message_reaction_revisions'
  }),
  dm: Object.freeze({
    reactions: 'direct_message_reactions',
    revisions: 'direct_message_reaction_revisions'
  })
});

function requireQuery(client) {
  if (!client || typeof client.query !== 'function') {
    throw new TypeError('Reaction repository requires a PostgreSQL query client');
  }
  return client;
}

function contextTables(type) {
  const tables = CONTEXT_TABLES[type];
  if (!tables) throw new TypeError('Reaction context must be room or dm');
  return tables;
}

function mapSummary(row, userId) {
  return {
    emoji: row.emoji,
    count: Number(row.reaction_count || 0),
    reactedByMe: Boolean(userId && row.reacted_by_me),
    revision: String(row.revision || 0)
  };
}

function mapReactor(row) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_key ? `/api/avatars/${encodeURIComponent(row.avatar_key)}` : null,
    cursorTuple: {
      createdAtMicros: String(row.created_at_micros),
      id: row.user_id
    }
  };
}

function createReactionRepository({ client } = {}) {
  const defaultClient = client ? requireQuery(client) : null;
  const queryClient = (override) => requireQuery(override || defaultClient);

  async function transaction(callback) {
    if (typeof callback !== 'function') throw new TypeError('Transaction callback is required');
    if (typeof defaultClient?.connect !== 'function') return callback(queryClient());
    const db = await defaultClient.connect();
    try {
      await db.query('BEGIN');
      const result = await callback(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }

  async function ensureRevision({ type, messageId, emoji, client: override } = {}) {
    const db = queryClient(override);
    const { revisions } = contextTables(type);
    await db.query(
      `INSERT INTO ${revisions} (message_id, emoji)
       VALUES ($1, $2)
       ON CONFLICT (message_id, emoji) DO NOTHING`,
      [messageId, emoji]
    );
    const result = await db.query(
      `SELECT revision
       FROM ${revisions}
       WHERE message_id = $1 AND emoji = $2
       FOR UPDATE`,
      [messageId, emoji]
    );
    return String(result.rows[0]?.revision || 0);
  }

  async function getActive({ type, messageId, emoji, userId, client: override } = {}) {
    const { reactions } = contextTables(type);
    const result = await queryClient(override).query(
      `SELECT EXISTS (
         SELECT 1 FROM ${reactions}
         WHERE message_id = $1 AND emoji = $2 AND user_id = $3
       ) AS active`,
      [messageId, emoji, userId]
    );
    return result.rows[0]?.active === true;
  }

  async function setDesiredState({ type, messageId, emoji, userId, active, client: override } = {}) {
    const db = queryClient(override);
    const { reactions, revisions } = contextTables(type);
    const currentRevision = await ensureRevision({ type, messageId, emoji, client: db });
    const currentActive = await getActive({ type, messageId, emoji, userId, client: db });

    if (currentActive === active) {
      return { changed: false, revision: currentRevision };
    }

    const revisionResult = await db.query(
      `UPDATE ${revisions}
       SET revision = revision + 1, updated_at = current_timestamp
       WHERE message_id = $1 AND emoji = $2
       RETURNING revision`,
      [messageId, emoji]
    );
    const revision = String(revisionResult.rows[0].revision);

    if (active) {
      await db.query(
        `INSERT INTO ${reactions} (message_id, emoji, user_id, revision)
         VALUES ($1, $2, $3, $4)`,
        [messageId, emoji, userId, revision]
      );
    } else {
      await db.query(
        `DELETE FROM ${reactions}
         WHERE message_id = $1 AND emoji = $2 AND user_id = $3`,
        [messageId, emoji, userId]
      );
    }

    return { changed: true, revision };
  }

  async function getSummary({ type, messageId, emoji, userId, client: override } = {}) {
    const { reactions, revisions } = contextTables(type);
    const result = await queryClient(override).query(
      `SELECT v.emoji, v.revision,
              COUNT(r.user_id)::integer AS reaction_count,
              COALESCE(BOOL_OR(r.user_id = $3), false) AS reacted_by_me
       FROM ${revisions} v
       LEFT JOIN ${reactions} r
         ON r.message_id = v.message_id AND r.emoji = v.emoji
       WHERE v.message_id = $1 AND v.emoji = $2
       GROUP BY v.emoji, v.revision`,
      [messageId, emoji, userId || null]
    );
    const row = result.rows[0];
    return row ? mapSummary(row, userId) : { emoji, count: 0, reactedByMe: false, revision: '0' };
  }

  async function listSummaries({ type, messageId, userId, client: override } = {}) {
    const { reactions, revisions } = contextTables(type);
    const result = await queryClient(override).query(
      `SELECT v.emoji, v.revision,
              COUNT(r.user_id)::integer AS reaction_count,
              COALESCE(BOOL_OR(r.user_id = $2), false) AS reacted_by_me
       FROM ${revisions} v
       JOIN ${reactions} r
         ON r.message_id = v.message_id AND r.emoji = v.emoji
       WHERE v.message_id = $1
       GROUP BY v.emoji, v.revision
       ORDER BY MIN(r.created_at), v.emoji`,
      [messageId, userId || null]
    );
    return result.rows.map((row) => mapSummary(row, userId));
  }

  async function listReactors({ type, messageId, emoji, limit, after, client: override } = {}) {
    const { reactions } = contextTables(type);
    const params = [messageId, emoji, limit];
    let cursorFilter = '';
    if (after) {
      params.push(after.createdAtMicros, after.id);
      cursorFilter = `AND (r.created_at, r.user_id) >
        (to_timestamp($4::numeric / 1000000), $5)`;
    }
    const result = await queryClient(override).query(
      `SELECT r.user_id,
              COALESCE(NULLIF(u.display_name, ''), u.login, 'Пользователь') AS display_name,
              u.avatar_key,
              FLOOR(EXTRACT(EPOCH FROM r.created_at) * 1000000)::bigint AS created_at_micros
       FROM ${reactions} r
       JOIN users u ON u.id = r.user_id
       WHERE r.message_id = $1 AND r.emoji = $2
         ${cursorFilter}
       ORDER BY r.created_at ASC, r.user_id ASC
       LIMIT $3`,
      params
    );
    return result.rows.map(mapReactor);
  }

  return Object.freeze({
    getActive,
    getSummary,
    listReactors,
    listSummaries,
    setDesiredState,
    transaction
  });
}

module.exports = { createReactionRepository };
