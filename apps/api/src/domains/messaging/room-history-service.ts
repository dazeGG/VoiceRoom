import { buildHistoryEnvelope, normalizeHistoryRequest, type HistoryEnvelope } from '@voice-room/shared/messaging-history';

type Tuple = { createdAtMicros: unknown; id: string };
type Loose = Record<string, unknown>;
type Access = { authorized?: boolean; [key: string]: unknown } | null | undefined;

export type StoredRoomMessage = {
  id: string;
  roomId?: string;
  createdAt?: unknown;
  createdAtMicros?: unknown;
  authorUserId?: unknown;
  peerId?: unknown;
  name?: unknown;
  avatarColorKey?: unknown;
  avatarKey?: string | null;
  avatarAccent?: unknown;
  content?: unknown;
  text?: unknown;
  editedAt?: unknown;
  expiresAt?: unknown;
  attachments?: unknown;
  linkPreview?: unknown;
  replyTo?: unknown;
  replyPreview?: unknown;
  [key: string]: unknown;
};

type HistoryPage = { messages: StoredRoomMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean };
type ListInput = { roomId: string; anchor: Tuple | undefined; limit: number; now: Date };

export interface RoomHistoryRepository {
  roomExists(roomId: string): Promise<boolean>;
  getAnchor?(input: { roomId: string; messageId: string }): Promise<Tuple | null>;
  listLatest(input: ListInput): Promise<HistoryPage>;
  listBefore(input: ListInput): Promise<HistoryPage>;
  listAfter(input: ListInput): Promise<HistoryPage>;
  listAround(input: ListInput): Promise<HistoryPage>;
}

export interface HistoryCursorCodec {
  encode(input: { purpose: string; context: string; tuple: Tuple }): string;
  decode(cursor: string | undefined, options: { purpose: string; context: string }): Tuple;
}

type VisibilityPolicy = {
  canViewRoomMessage?(context: Loose): boolean | Promise<boolean>;
  requireRoomMessage?(context: Loose): unknown;
};

class RoomHistoryError extends Error {
  declare code: string;
  declare statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = 'RoomHistoryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createRoomHistoryService({ repository, cursorCodec, visibilityPolicy, projectMessage, now = () => new Date() }: {
  repository?: RoomHistoryRepository;
  cursorCodec?: HistoryCursorCodec;
  visibilityPolicy?: VisibilityPolicy;
  projectMessage?: (input: { message: StoredRoomMessage; roomId: string; access: Access }) => Promise<StoredRoomMessage> | StoredRoomMessage;
  now?: () => Date;
} = {}) {
  if (!repository) throw new TypeError('room history repository is required');
  if (!cursorCodec?.encode || !cursorCodec?.decode) throw new TypeError('cursor codec is required');
  const history = repository;
  const codec = cursorCodec;

  function contextFor(roomId: string): string {
    return `room:${roomId}`;
  }

  function encodeTuple(roomId: string, tuple: Tuple, purpose = 'room-history'): string {
    return codec.encode({ purpose, context: contextFor(roomId), tuple });
  }

  function decodeTuple(roomId: string, cursor: string | undefined): Tuple {
    return codec.decode(cursor, { purpose: 'room-history', context: contextFor(roomId) });
  }

  function canView(message: StoredRoomMessage, access: Access): boolean | Promise<boolean> {
    if (!visibilityPolicy) return true;
    if (typeof visibilityPolicy.canViewRoomMessage === 'function') {
      return visibilityPolicy.canViewRoomMessage({
        ...access,
        authorized: access?.authorized === true,
        message,
        roomId: message.roomId
      });
    }
    if (typeof visibilityPolicy.requireRoomMessage === 'function') {
      visibilityPolicy.requireRoomMessage({
        ...access,
        authorized: access?.authorized === true,
        message,
        roomId: message.roomId
      });
    }
    return true;
  }

  function toDto(roomId: string, message: StoredRoomMessage) {
    const tuple = { createdAtMicros: message.createdAtMicros, id: message.id };
    return {
      id: message.id,
      kind: 'room',
      createdAt: message.createdAt,
      author: {
        userId: message.authorUserId,
        peerId: message.peerId,
        name: message.name,
        avatarColorKey: message.avatarColorKey,
        avatarUrl: message.avatarKey ? `/api/avatars/${encodeURIComponent(message.avatarKey)}` : null,
        avatarAccent: message.avatarAccent
      },
      content: message.content || { type: 'text', text: message.text },
      editedAt: message.editedAt,
      expiresAt: message.expiresAt,
      attachments: message.attachments,
      linkPreview: message.linkPreview,
      replyTo: message.replyTo,
      replyPreview: message.replyPreview,
      cursor: encodeTuple(roomId, tuple),
      readCursor: encodeTuple(roomId, tuple, 'room-read')
    };
  }

  async function getPage({ roomId, query = {}, access = { authorized: true } }: { roomId?: unknown; query?: Loose; access?: Access } = {}): Promise<HistoryEnvelope> {
    const normalizedRoomId = String(roomId || '').trim();
    if (!normalizedRoomId) throw new RoomHistoryError('room_not_found', 404, 'Room not found');

    let normalizedQuery = query;
    if (query.mode === 'around' && !query.cursor && typeof query.messageId === 'string' && query.messageId.trim()) {
      const tuple = await history.getAnchor?.({ roomId: normalizedRoomId, messageId: query.messageId.trim() });
      if (!tuple) throw new RoomHistoryError('message_not_found', 404, 'Message not found');
      normalizedQuery = { ...query, cursor: encodeTuple(normalizedRoomId, tuple) };
    }
    const parsed = normalizeHistoryRequest(normalizedQuery);
    if (!parsed.ok) throw new RoomHistoryError(parsed.code, 400, 'Invalid history cursor');
    if (!(await history.roomExists(normalizedRoomId))) {
      throw new RoomHistoryError('room_not_found', 404, 'Room not found');
    }

    const { mode, limit, cursor } = parsed.request;
    let anchor: Tuple | undefined;
    if (mode !== 'latest') {
      try {
        anchor = decodeTuple(normalizedRoomId, cursor);
      } catch {
        throw new RoomHistoryError('invalid_cursor', 400, 'Invalid history cursor');
      }
    }

    const method = ({
      latest: 'listLatest',
      before: 'listBefore',
      after: 'listAfter',
      around: 'listAround'
    } as const)[mode];
    const page = await history[method]({
      roomId: normalizedRoomId,
      anchor,
      limit,
      now: now()
    });
    const visible: StoredRoomMessage[] = [];
    for (const message of page.messages) {
      if (await canView(message, access)) visible.push(message);
    }
    const projected = typeof projectMessage === 'function'
      ? await Promise.all(visible.map((message) => projectMessage({ message, roomId: normalizedRoomId, access })))
      : visible;
    const messages = projected.map((message) => toDto(normalizedRoomId, message));

    return buildHistoryEnvelope({
      mode,
      messages,
      pageInfo: {
        before: messages[0]?.cursor,
        after: messages.at(-1)?.cursor,
        around: mode === 'around' ? cursor : undefined,
        hasMoreBefore: page.hasMoreBefore,
        hasMoreAfter: page.hasMoreAfter
      }
    });
  }

  return { getPage };
}

export { RoomHistoryError, createRoomHistoryService };
