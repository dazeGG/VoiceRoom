'use strict';

const {
  contentFromLegacyText,
  normalizeRoomMessageContent,
  projectRoomMessageContent
} = require('@voice-room/shared/room-message-content');

function createContentRepository() {
  function prepareWrite({ content, text }) {
    const normalized = content == null ? contentFromLegacyText(text) : normalizeRoomMessageContent(content);
    if (!normalized) {
      const error = new TypeError('Invalid room message content');
      error.code = 'INVALID_MESSAGE_CONTENT';
      throw error;
    }
    return { content: normalized, text: projectRoomMessageContent(normalized, text) };
  }

  async function update({ client, content, messageId, text }) {
    const prepared = prepareWrite({ content, text });
    const result = await client.query(
      `UPDATE room_messages
       SET content = $2::jsonb, text = $3, edited_at = current_timestamp
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING *`,
      [messageId, JSON.stringify(prepared.content), prepared.text]
    );
    return result.rows[0] || null;
  }

  return Object.freeze({ prepareWrite, update });
}

module.exports = { createContentRepository };
