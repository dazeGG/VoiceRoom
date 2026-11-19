import { DomainError } from '../../platform/http/domain-error.ts';
import {
  contentFromPlainText,
  MAX_ROOM_MESSAGE_LENGTH,
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
    const projected = projectRoomMessageContent(normalized, text);
    if (projected.length > MAX_ROOM_MESSAGE_LENGTH) {
      throw new DomainError('invalid_message_content', 400, 'Invalid room message content');
    }
    return { content: normalized, text: projected };
  }

  return Object.freeze({ prepareWrite });
}

/** An edit can keep a mention already attached to this message. */
export function contentFromEditedText(
  text: string,
  previous: RoomMessageContentV1 | null | undefined
): RoomMessageContentV1 | null {
  const mentions = new Map(
    previous?.segments.flatMap((segment) => (segment.type === 'mention' ? [[segment.label, segment] as const] : []))
  );
  if (mentions.size === 0) return contentFromPlainText(text);

  const segments: RoomMessageContentV1['segments'] = [];
  let offset = 0;
  for (const match of text.matchAll(/(?<![\p{L}\p{N}._@-])@[a-z0-9._-]+/giu)) {
    const mention = mentions.get(match[0]);
    if (!mention) continue;
    if (match.index > offset) segments.push({ type: 'text', text: text.slice(offset, match.index) });
    segments.push(mention);
    offset = match.index + match[0].length;
    mentions.delete(mention.label);
  }
  if (offset < text.length) segments.push({ type: 'text', text: text.slice(offset) });
  return normalizeRoomMessageContent({ version: 1, segments }) ?? contentFromPlainText(text);
}

export { createContentRepository };
