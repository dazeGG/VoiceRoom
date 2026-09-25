import {
  contentFromLegacyText,
  normalizeRoomMessageContent,
  projectRoomMessageContent,
  type RoomMessageContentV1
} from '@voice-room/shared/room-message-content';

type Queryable = { query(sql: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }> };

export type ContentRepository = Readonly<{
  prepareWrite(input: { content?: unknown; text?: unknown }): { content: RoomMessageContentV1; text: string };
  update(input: {
    client: Queryable;
    content?: unknown;
    messageId: string;
    text?: unknown;
  }): Promise<Record<string, unknown> | null>;
}>;

function createContentRepository(): ContentRepository {
  function prepareWrite({ content, text }: { content?: unknown; text?: unknown }): {
    content: RoomMessageContentV1;
    text: string;
  } {
    const normalized = content == null ? contentFromLegacyText(text) : normalizeRoomMessageContent(content);
    if (!normalized) {
      const error = new TypeError('Invalid room message content') as TypeError & { code?: string };
      error.code = 'INVALID_MESSAGE_CONTENT';
      throw error;
    }
    return { content: normalized, text: projectRoomMessageContent(normalized, text) };
  }

  async function update({
    client,
    content,
    messageId,
    text
  }: {
    client: Queryable;
    content?: unknown;
    messageId: string;
    text?: unknown;
  }): Promise<Record<string, unknown> | null> {
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

export { createContentRepository };
