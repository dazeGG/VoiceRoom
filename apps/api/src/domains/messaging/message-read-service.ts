type CursorTuple = unknown;
type ReadState = { unchanged?: boolean; last_read_message_created_at?: unknown } | null | undefined;

export interface CursorCodec {
  decode(cursor: string, options: { purpose: string; context: string }): CursorTuple;
}

export interface MessageReadRepository {
  advanceRoom(input: { roomId: string; userId: string; tuple: CursorTuple }): Promise<ReadState>;
  advanceDm(input: { peerId: string; userId: string; tuple: CursorTuple }): Promise<ReadState>;
}

export type MessageReadService = Readonly<{
  advanceDm(input: { cursor: string; peerId: string; userId: string }): Promise<{ advanced: boolean; cursor: string }>;
  advanceRoom(input: { cursor: string; roomId: string; userId: string }): Promise<{ advanced: boolean; cursor: string; readThrough: unknown }>;
}>;

class MessageReadError extends Error {
  declare code: string;
  declare statusCode: number;

  constructor(code = 'invalid_read_cursor', statusCode = 400) {
    super('Invalid read cursor');
    this.name = 'MessageReadError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createMessageReadService({ authorizeRoomRead, cursorCodec, repository }: {
  authorizeRoomRead?: (input: { roomId: string; userId: string }) => boolean | Promise<boolean>;
  cursorCodec?: CursorCodec;
  repository?: MessageReadRepository;
} = {}): MessageReadService {
  if (!cursorCodec?.decode) throw new TypeError('Cursor codec is required');
  if (!repository) throw new TypeError('Message read repository is required');
  const codec = cursorCodec;
  const reads = repository;

  function decode(cursor: string, purpose: string, context: string): CursorTuple {
    try {
      return codec.decode(cursor, { purpose, context });
    } catch {
      throw new MessageReadError();
    }
  }

  async function advanceRoom({ cursor, roomId, userId }: { cursor: string; roomId: string; userId: string }) {
    if (typeof authorizeRoomRead !== 'function' || await authorizeRoomRead({ roomId, userId }) !== true) {
      throw new MessageReadError('room_forbidden', 403);
    }
    const tuple = decode(cursor, 'room-read', `room:${roomId}`);
    const state = await reads.advanceRoom({ roomId, userId, tuple });
    if (!state) throw new MessageReadError('message_not_visible', 409);
    // The caller retires this room's notifications up to here, so it needs to
    // know how far the read actually reached.
    return {
      advanced: !state.unchanged,
      cursor,
      readThrough: state.last_read_message_created_at ?? null
    };
  }

  async function advanceDm({ cursor, peerId, userId }: { cursor: string; peerId: string; userId: string }) {
    const participants = userId < peerId ? [userId, peerId] : [peerId, userId];
    const tuple = decode(cursor, 'dm-read', `dm:${participants.join(':')}`);
    const state = await reads.advanceDm({ peerId, userId, tuple });
    if (!state) throw new MessageReadError('message_not_visible', 409);
    return { advanced: !state.unchanged, cursor };
  }

  return Object.freeze({ advanceDm, advanceRoom });
}

export { MessageReadError, createMessageReadService };
