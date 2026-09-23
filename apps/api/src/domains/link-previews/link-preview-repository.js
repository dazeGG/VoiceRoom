function createLinkPreviewRepository({ pool }) {
  if (!pool) throw new TypeError('A database pool is required');

  async function getCached(urlHash, now) {
    const result = await pool.query(
      `SELECT status, preview, failure_code FROM link_previews WHERE url_hash = $1 AND expires_at > $2`,
      [urlHash, new Date(now)]
    );
    const row = result.rows[0];
    return row ? { status: row.status, preview: row.preview, failureCode: row.failure_code } : null;
  }

  async function saveCached({ urlHash, url, preview, failureCode = null, now, ttlMs }) {
    await pool.query(
      `INSERT INTO link_previews (url_hash, url, status, preview, failure_code, fetched_at, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       ON CONFLICT (url_hash) DO UPDATE
       SET url = EXCLUDED.url, status = EXCLUDED.status, preview = EXCLUDED.preview,
           failure_code = EXCLUDED.failure_code, fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at`,
      [
        urlHash,
        url,
        preview ? 'ready' : 'failed',
        preview ? JSON.stringify(preview) : null,
        preview ? null : failureCode,
        new Date(now),
        new Date(now + ttlMs)
      ]
    );
  }

  // The preview is written only while the message still has the text it was
  // built from, and only when it actually changes, so an edit that raced the
  // fetch is never overwritten and nobody is told about a no-op.
  const PREVIEW_ASSIGNMENT = `metadata = CASE
    WHEN $4::jsonb IS NULL THEN metadata - 'linkPreview'
    ELSE jsonb_set(metadata, '{linkPreview}', $4::jsonb)
  END`;

  async function setRoomMessagePreview({ roomId, messageId, text, preview }) {
    const result = await pool.query(
      `UPDATE room_messages SET ${PREVIEW_ASSIGNMENT}
       WHERE room_id = $1 AND id = $2 AND text = $3 AND deleted_at IS NULL
         AND (metadata -> 'linkPreview') IS DISTINCT FROM $4::jsonb`,
      [roomId, messageId, text, preview ? JSON.stringify(preview) : null]
    );
    return result.rowCount > 0;
  }

  async function setDirectMessagePreview({ messageId, senderId, text, preview }) {
    const result = await pool.query(
      `UPDATE direct_messages SET ${PREVIEW_ASSIGNMENT}
       WHERE id = $1 AND sender_id = $2 AND body = $3 AND deleted_at IS NULL
         AND (metadata -> 'linkPreview') IS DISTINCT FROM $4::jsonb`,
      [messageId, senderId, text, preview ? JSON.stringify(preview) : null]
    );
    return result.rowCount > 0;
  }

  async function listReferencedImageKeys() {
    const result = await pool.query(
      `SELECT preview -> 'image' ->> 'key' AS key FROM link_previews
       WHERE preview -> 'image' ->> 'key' IS NOT NULL
       UNION
       SELECT metadata -> 'linkPreview' -> 'image' ->> 'key' FROM room_messages
       WHERE metadata -> 'linkPreview' -> 'image' ->> 'key' IS NOT NULL
       UNION
       SELECT metadata -> 'linkPreview' -> 'image' ->> 'key' FROM direct_messages
       WHERE metadata -> 'linkPreview' -> 'image' ->> 'key' IS NOT NULL`
    );
    return result.rows.map((row) => row.key).filter(Boolean);
  }

  async function pruneExpired(now) {
    const result = await pool.query('DELETE FROM link_previews WHERE expires_at <= $1', [new Date(now)]);
    return result.rowCount;
  }

  return {
    getCached,
    listReferencedImageKeys,
    pruneExpired,
    saveCached,
    setDirectMessagePreview,
    setRoomMessagePreview
  };
}

export { createLinkPreviewRepository };
