// Message history wired together: room and DM pages around a cursor (each
// message with its attachments and reply preview) and read cursors.

import type pg from 'pg';
import type { CursorCodec } from '../../platform/cursor-codec.ts';
import type { createMessageProjection } from './message-projection.ts';
import { createDmHistoryRepository } from './dm-history.repository.ts';
import { createDmHistoryService } from './dm-history.service.ts';
import { createMessageReadRepository } from './message-read.repository.ts';
import { createMessageReadService } from './message-read.service.ts';
import { createMessageVisibilityService } from './message-visibility.service.ts';
import { createReplyRepository } from './reply.repository.ts';
import { createRoomHistoryRepository } from './room-history.repository.ts';
import { createRoomHistoryService } from './room-history.service.ts';

export interface HistoryModuleDeps {
  pool: pg.Pool;
  cursorCodec: CursorCodec;
  projectMedia: ReturnType<typeof createMessageProjection>['projectMedia'];
  canReadRoom: (roomId: string, userId: string) => Promise<boolean>;
}

export function createHistoryModule(deps: HistoryModuleDeps) {
  const { pool, cursorCodec } = deps;
  const visibilityPolicy = createMessageVisibilityService();
  const replies = () => createReplyRepository({ client: pool });
  return {
    cursorCodec,
    dm: createDmHistoryService({
      cursorCodec,
      repository: createDmHistoryRepository({ pool }),
      projectMessage: async ({ message, peerId, userId }) => {
        const projected = await deps.projectMedia('dm', message);
        if (!projected.replyTo?.messageId) return projected;
        return {
          ...projected,
          replyPreview: await replies().getDirectPreview({ userId, peerId, messageId: projected.replyTo.messageId })
        };
      },
      visibilityPolicy
    }),
    room: createRoomHistoryService({
      cursorCodec,
      repository: createRoomHistoryRepository({ pool }),
      projectMessage: async ({ message, roomId }) => {
        const projected = await deps.projectMedia('room', message);
        if (!projected.replyTo?.messageId) return projected;
        return {
          ...projected,
          replyPreview: await replies().getRoomPreview({ roomId, messageId: projected.replyTo.messageId })
        };
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
