import {
  contentFromLegacyText,
  normalizeRoomMessageContent,
  projectRoomMessageContent,
  type RoomMessageContentV1
} from '@voice-room/shared/room-message-content';

import { sql } from 'kysely';
import { kyselyOn, type Queryable } from '../../platform/db/kysely.ts';

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
    const row = await kyselyOn(client)
      .updateTable('room_messages')
      .set({ content: JSON.stringify(prepared.content), text: prepared.text, edited_at: sql<Date>`current_timestamp` })
      .where('id', '=', messageId)
      .where('deleted_at', 'is', null)
      .returningAll()
      .executeTakeFirst();
    return row || null;
  }

  return Object.freeze({ prepareWrite, update });
}

export { createContentRepository };
