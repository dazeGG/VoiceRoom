import type { CursorCodec, CursorTuple } from '../../platform/cursor-codec.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import { dmCursorScopes, roomCursorScopes, type CursorScope } from './cursor-scopes.ts';
import type { MessageReadRepository as StoredReads } from './message-read.repository.ts';

export type MessageReadRepository = Pick<StoredReads, 'advanceDm' | 'advanceRoom'>;

export type MessageReadService = Readonly<{
  advanceDm(input: { cursor: string; peerId: string; userId: string }): Promise<{ advanced: boolean; cursor: string }>;
  advanceRoom(input: {
    cursor: string;
    roomId: string;
    userId: string;
  }): Promise<{ advanced: boolean; cursor: string; readThrough: unknown }>;
}>;

function readRefusal(code: 'invalid_read_cursor' | 'message_not_visible' | 'room_forbidden', status: number) {
  return new DomainError(code, status, 'Invalid read cursor');
}

function createMessageReadService({
  authorizeRoomRead,
  cursorCodec,
  repository
}: {
  authorizeRoomRead: (input: { roomId: string; userId: string }) => boolean | Promise<boolean>;
  cursorCodec: Pick<CursorCodec, 'decode'>;
  repository: MessageReadRepository;
}): MessageReadService {
  function decode(cursor: string, scope: CursorScope): CursorTuple {
    try {
      return cursorCodec.decode(cursor, scope);
    } catch {
      throw readRefusal('invalid_read_cursor', 400);
    }
  }

  async function advanceRoom({ cursor, roomId, userId }: { cursor: string; roomId: string; userId: string }) {
    if ((await authorizeRoomRead({ roomId, userId })) !== true) throw readRefusal('room_forbidden', 403);
    const tuple = decode(cursor, roomCursorScopes(roomId).read);
    const state = await repository.advanceRoom({ roomId, userId, tuple });
    if (!state) throw readRefusal('message_not_visible', 409);
    // The caller retires this room's notifications up to here, so it needs to
    // know how far the read actually reached.
    if ('unchanged' in state) return { advanced: false, cursor, readThrough: null };
    return { advanced: true, cursor, readThrough: state.last_read_message_created_at ?? null };
  }

  async function advanceDm({ cursor, peerId, userId }: { cursor: string; peerId: string; userId: string }) {
    const tuple = decode(cursor, dmCursorScopes(userId, peerId).read);
    const state = await repository.advanceDm({ peerId, userId, tuple });
    if (!state) throw readRefusal('message_not_visible', 409);
    return { advanced: !('unchanged' in state), cursor };
  }

  return Object.freeze({ advanceDm, advanceRoom });
}

export { createMessageReadService };
