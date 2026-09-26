// Reactions wired together: who may read or react to a message, the toggle
// and its summary, and the realtime fan-out (the room detail stream for a
// room, both accounts for a DM).

import type pg from 'pg';
import type { ServerEnvelope } from '@voice-room/shared/realtime';
import type { CursorCodec } from '../../platform/cursor-codec.ts';
import { createReactionRealtimeAdapter } from './reaction-realtime-adapter.ts';
import { createReactionRepository } from './reaction.repository.ts';
import { createReactionService } from './reaction.service.ts';

export interface ReactionsModuleDeps {
  pool: pg.Pool;
  cursorCodec: CursorCodec;
  roomExists: (roomId: string) => Promise<boolean>;
  roomMessageExists: (roomId: string, messageId: string) => Promise<boolean>;
  directMessageVisible: (userId: string, peerId: string, messageId: string) => Promise<boolean>;
  canReadRoom: (roomId: string, userId: string) => Promise<boolean>;
  canReactInRoom: (roomId: string, userId: string) => Promise<boolean>;
  broadcastRoomDetail: (roomId: string, envelope: ServerEnvelope) => void;
  /** Sends to every socket of an account; answers how many took it. */
  sendToUser: (userId: string, envelope: ServerEnvelope) => number;
  writesEnabled: () => boolean;
}

export function createReactionsModule(deps: ReactionsModuleDeps) {
  const realtime = createReactionRealtimeAdapter({
    broadcastRoom: async (roomId, event) => {
      if (!(await deps.roomExists(roomId))) return false;
      deps.broadcastRoomDetail(roomId, event);
      return true;
    },
    // A reaction event is already a server event, so it skips the account
    // event mapping (which knows only the legacy account messages).
    broadcastAccount: (userId, event) => deps.sendToUser(userId, event) > 0,
    resolveDirectRecipients: ({ actorUserId, conversation }) => [actorUserId, conversation!.id] as string[]
  });
  const service = createReactionService({
    repository: createReactionRepository({ client: deps.pool }),
    cursorCodec: deps.cursorCodec,
    // Guests read the reactions of any existing room; members read or react
    // where the room's chat rules let them; a DM is visible to its two users.
    requireVisible: async ({ conversation, messageId, viewer, operation }) => {
      if (conversation.type === 'room') {
        if (!(await deps.roomMessageExists(conversation.id, messageId))) return false;
        if (operation === 'read' && !viewer?.id) return deps.roomExists(conversation.id);
        if (!viewer?.id) return false;
        return operation === 'read'
          ? deps.canReadRoom(conversation.id, viewer.id)
          : deps.canReactInRoom(conversation.id, viewer.id);
      }
      if (!viewer?.id) return false;
      return deps.directMessageVisible(viewer.id, conversation.id, messageId);
    },
    writesEnabled: deps.writesEnabled,
    publish: realtime.publish
  });
  return { realtime, service };
}

export type ReactionsModule = ReturnType<typeof createReactionsModule>;
