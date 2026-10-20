import type { ErrorCode } from '@voice-room/shared/contracts/errors';
import type {
  Attachment,
  LinkPreview,
  MessageContent,
  ReplyPointer,
  ReactionSummary,
  ReplyPreview,
  RoomHistoryMessage,
  RoomHistoryPage
} from '@voice-room/shared/contracts/messages';
import { textOf } from '@voice-room/shared/guards';
import { normalizeHistoryRequest } from '@voice-room/shared/messaging-history';
import { epochMillis } from '../../platform/epoch-millis.ts';
import { avatarUrl } from '../../lib/avatar-url.ts';

type Tuple = { createdAtMicros: unknown; id: string };
type Loose = Record<string, unknown>;
type Access = { authorized?: boolean; [key: string]: unknown } | null | undefined;

/** A room message as the history repository reads it; times come as the driver returns them. */
export type StoredRoomMessage = {
  id: string;
  roomId: string;
  createdAt: unknown;
  createdAtMicros: unknown;
  authorUserId?: string | null | undefined;
  peerId?: string | undefined;
  name?: string | undefined;
  avatarColorKey?: string | null | undefined;
  avatarKey?: string | null | undefined;
  avatarAccent?: string | null | undefined;
  content?: MessageContent | null | undefined;
  text?: string | undefined;
  editedAt?: unknown;
  expiresAt?: unknown;
  attachments?: Attachment[] | undefined;
  linkPreview?: LinkPreview | null | undefined;
  replyTo?: ReplyPointer | null | undefined;
  replyPreview?: ReplyPreview | null | undefined;
  reactions?: ReactionSummary[] | undefined;
};

type HistoryPage = { messages: StoredRoomMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean };
type ListInput = { roomId: string; anchor: Tuple | undefined; limit: number; now: Date };
// Every mode except 'latest' decodes an anchor from its cursor first.
type AnchoredInput = Omit<ListInput, 'anchor'> & { anchor: Tuple };

export interface RoomHistoryRepository {
  roomExists(roomId: string): Promise<boolean>;
  getAnchor?(input: { roomId: string; messageId: string }): Promise<Tuple | null>;
  listLatest(input: ListInput): Promise<HistoryPage>;
  listBefore(input: AnchoredInput): Promise<HistoryPage>;
  listAfter(input: AnchoredInput): Promise<HistoryPage>;
  listAround(input: AnchoredInput): Promise<HistoryPage>;
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
  declare code: ErrorCode;
  declare statusCode: number;

  constructor(code: ErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = 'RoomHistoryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createRoomHistoryService({
  repository,
  cursorCodec,
  visibilityPolicy,
  projectMessages,
  now = () => new Date()
}: {
  repository?: RoomHistoryRepository;
  cursorCodec?: HistoryCursorCodec;
  visibilityPolicy?: VisibilityPolicy;
  /** Adds what a page's messages carry beyond their row, for the whole page at once. */
  projectMessages?: (input: {
    messages: StoredRoomMessage[];
    roomId: string;
    access: Access;
  }) => Promise<StoredRoomMessage[]> | StoredRoomMessage[];
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

  function toDto(roomId: string, message: StoredRoomMessage): RoomHistoryMessage {
    const tuple = { createdAtMicros: message.createdAtMicros, id: message.id };
    return {
      id: message.id,
      kind: 'room',
      createdAt: epochMillis(message.createdAt),
      author: {
        userId: message.authorUserId ?? null,
        peerId: message.peerId ?? '',
        name: message.name ?? '',
        avatarColorKey: message.avatarColorKey ?? null,
        avatarUrl: avatarUrl(message.avatarKey),
        avatarAccent: message.avatarAccent ?? null
      },
      content: message.content || { type: 'text', text: message.text ?? '' },
      editedAt: epochMillis(message.editedAt),
      expiresAt: epochMillis(message.expiresAt),
      ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
      ...(message.linkPreview == null ? {} : { linkPreview: message.linkPreview }),
      ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
      ...(message.replyPreview === undefined ? {} : { replyPreview: message.replyPreview }),
      ...(message.reactions === undefined ? {} : { reactions: message.reactions }),
      cursor: encodeTuple(roomId, tuple),
      readCursor: encodeTuple(roomId, tuple, 'room-read')
    };
  }

  async function getPage({
    roomId,
    query = {},
    access = { authorized: true }
  }: { roomId?: unknown; query?: Loose; access?: Access } = {}): Promise<RoomHistoryPage> {
    const normalizedRoomId = textOf(roomId).trim();
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
    let page: HistoryPage;
    if (mode === 'latest') {
      page = await history.listLatest({ roomId: normalizedRoomId, anchor: undefined, limit, now: now() });
    } else {
      let anchor: Tuple;
      try {
        anchor = decodeTuple(normalizedRoomId, cursor);
      } catch {
        throw new RoomHistoryError('invalid_cursor', 400, 'Invalid history cursor');
      }
      const method = ({ before: 'listBefore', after: 'listAfter', around: 'listAround' } as const)[mode];
      page = await history[method]({ roomId: normalizedRoomId, anchor, limit, now: now() });
    }
    const visible: StoredRoomMessage[] = [];
    for (const message of page.messages) {
      if (await canView(message, access)) visible.push(message);
    }
    const projected =
      typeof projectMessages === 'function' && visible.length > 0
        ? await projectMessages({ messages: visible, roomId: normalizedRoomId, access })
        : visible;
    const messages = projected.map((message) => toDto(normalizedRoomId, message));
    const first = messages[0];
    const last = messages.at(-1);

    return {
      contractVersion: 1,
      mode,
      messages,
      pageInfo: {
        ...(first === undefined ? {} : { before: first.cursor }),
        ...(last === undefined ? {} : { after: last.cursor }),
        ...(mode === 'around' && cursor !== undefined ? { around: cursor } : {}),
        hasMoreBefore: page.hasMoreBefore,
        hasMoreAfter: page.hasMoreAfter
      }
    };
  }

  return { getPage };
}

export { createRoomHistoryService };
