// Message history wired together: room and DM pages around a cursor (each
// message with its attachments, reply preview and reactions) and read cursors.

import type pg from 'pg';
import type { CursorCodec } from '../../platform/cursor-codec.ts';
import type { createMessageProjection } from './message-projection.ts';
import { createDmHistoryRepository } from './dm-history.repository.ts';
import { createDmHistoryService } from './dm-history.service.ts';
import { createMessageReadRepository } from './message-read.repository.ts';
import { createMessageReadService } from './message-read.service.ts';
import { createMessageVisibilityService } from './message-visibility.service.ts';
import { createReactionRepository } from './reaction.repository.ts';
import { createReplyRepository } from './reply.repository.ts';
import { createRoomHistoryRepository } from './room-history.repository.ts';
import { createRoomHistoryService } from './room-history.service.ts';

export interface HistoryModuleDeps {
  pool: pg.Pool;
  cursorCodec: CursorCodec;
  projectMediaMany: ReturnType<typeof createMessageProjection>['projectMediaMany'];
  canReadRoom: (roomId: string, userId: string) => Promise<boolean>;
}

function replyIds(messages: Array<{ replyTo?: { messageId?: string } | null }>): string[] {
  return messages.flatMap((message) => (message.replyTo?.messageId ? [message.replyTo.messageId] : []));
}

// A page costs one query each for attachments, quotes and reactions, not one per message.
export function createHistoryModule(deps: HistoryModuleDeps) {
  const { pool, cursorCodec } = deps;
  const visibilityPolicy = createMessageVisibilityService();
  const replies = createReplyRepository({ client: pool });
  const reactions = createReactionRepository({ client: pool });
  return {
    cursorCodec,
    dm: createDmHistoryService({
      cursorCodec,
      repository: createDmHistoryRepository({ pool }),
      projectMessages: async ({ messages, peerId, userId }) => {
        const messageIds = messages.map((message) => message.id);
        const [projected, previews, summaries] = await Promise.all([
          deps.projectMediaMany('dm', messages),
          replies.getDirectPreviews({ userId, peerId, messageIds: replyIds(messages) }),
          reactions.listSummariesForMessages({ type: 'dm', messageIds, userId })
        ]);
        return projected.map((message) => ({
          ...message,
          ...(message.replyTo?.messageId ? { replyPreview: previews.get(message.replyTo.messageId) ?? null } : {}),
          reactions: summaries.get(message.id) ?? []
        }));
      },
      visibilityPolicy
    }),
    room: createRoomHistoryService({
      cursorCodec,
      repository: createRoomHistoryRepository({ pool }),
      projectMessages: async ({ messages, roomId, access }) => {
        const messageIds = messages.map((message) => message.id);
        const viewerId = typeof access?.userId === 'string' ? access.userId : null;
        const [projected, previews, summaries] = await Promise.all([
          deps.projectMediaMany('room', messages),
          replies.getRoomPreviews({ roomId, messageIds: replyIds(messages) }),
          reactions.listSummariesForMessages({ type: 'room', messageIds, userId: viewerId })
        ]);
        return projected.map((message) => ({
          ...message,
          ...(message.replyTo?.messageId ? { replyPreview: previews.get(message.replyTo.messageId) ?? null } : {}),
          reactions: summaries.get(message.id) ?? []
        }));
      },
      visibilityPolicy
    }),
    read: createMessageReadService({
      authorizeRoomRead: ({ roomId, userId }) => deps.canReadRoom(roomId, userId),
      cursorCodec,
      repository: createMessageReadRepository({ pool })
    })
  };
}

export type HistoryModule = ReturnType<typeof createHistoryModule>;
