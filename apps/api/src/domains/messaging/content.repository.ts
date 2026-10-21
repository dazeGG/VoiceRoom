import { DomainError } from '../../platform/http/domain-error.ts';
import {
  contentFromPlainText,
  normalizeRoomMessageContent,
  projectRoomMessageContent,
  type RoomMessageContentV1
} from '@voice-room/shared/room-message-content';

export type ContentRepository = Readonly<{
  prepareWrite(input: { content?: unknown; text?: unknown }): { content: RoomMessageContentV1; text: string };
}>;

function createContentRepository(): ContentRepository {
  function prepareWrite({ content, text }: { content?: unknown; text?: unknown }): {
    content: RoomMessageContentV1;
    text: string;
  } {
    const normalized = content == null ? contentFromPlainText(text) : normalizeRoomMessageContent(content);
    if (!normalized) {
      throw new DomainError('invalid_message_content', 400, 'Invalid room message content');
    }
    return { content: normalized, text: projectRoomMessageContent(normalized, text) };
  }

  return Object.freeze({ prepareWrite });
}

export { createContentRepository };
