import {
  normalizeRoomMessageContent,
  projectRoomMessageContent,
  type RoomMessageContentV1
} from '@voice-room/shared/room-message-content';

export type StoredRoomMessageRow = { content?: unknown; text?: unknown; [key: string]: unknown };

function projectStoredRoomMessage<T extends StoredRoomMessageRow>(
  row: T | null | undefined
): (T & { content: RoomMessageContentV1 | null; text: string }) | null {
  if (!row) return null;
  const content = normalizeRoomMessageContent(row.content);
  return {
    ...row,
    content,
    text: projectRoomMessageContent(content, row.text)
  };
}

export { projectStoredRoomMessage };
