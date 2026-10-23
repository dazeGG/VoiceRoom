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
import { normalizeHistoryRequest } from '@voice-room/shared/messaging-history';
import type { CursorCodec, CursorTuple } from '../../platform/cursor-codec.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import { avatarUrl } from '../../lib/avatar-url.ts';
import { roomCursorScopes } from './cursor-scopes.ts';
import { pageHistory, type HistoryQueryInput } from './history-pager.ts';

type Access = Readonly<{ authorized?: boolean | undefined; userId?: string | undefined }> | null | undefined;

/** A room message as the history repository reads it; times are epoch milliseconds. */
export type StoredRoomMessage = {
  id: string;
  roomId: string;
  createdAt: number;
  createdAtMicros: string;
  authorUserId?: string | null | undefined;
  peerId?: string | undefined;
  name?: string | undefined;
  avatarColorKey?: string | null | undefined;
  avatarKey?: string | null | undefined;
  avatarAccent?: string | null | undefined;
  content?: MessageContent | null | undefined;
  text?: string | undefined;
  editedAt?: number | null | undefined;
  expiresAt?: number | null | undefined;
  attachments?: Attachment[] | undefined;
  linkPreview?: LinkPreview | null | undefined;
  replyTo?: ReplyPointer | null | undefined;
  replyPreview?: ReplyPreview | null | undefined;
  reactions?: ReactionSummary[] | undefined;
};

type HistoryPage = { messages: StoredRoomMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean };
type ListInput = { roomId: string; limit: number; now: Date };
// Every mode except 'latest' decodes an anchor from its cursor first.
type AnchoredInput = ListInput & { anchor: CursorTuple };

export interface RoomHistoryRepository {
  roomExists(roomId: string): Promise<boolean>;
  getAnchor(input: { roomId: string; messageId: string }): Promise<CursorTuple | null>;
  listLatest(input: ListInput): Promise<HistoryPage>;
  listBefore(input: AnchoredInput): Promise<HistoryPage>;
  listAfter(input: AnchoredInput): Promise<HistoryPage>;
  listAround(input: AnchoredInput): Promise<HistoryPage>;
}

type RoomMessageView = { authorized: boolean; message: StoredRoomMessage; roomId: string; userId?: string | undefined };

type VisibilityPolicy = {
  canViewRoomMessage(context: RoomMessageView): boolean | Promise<boolean>;
};

function createRoomHistoryService({
  repository,
  cursorCodec,
  visibilityPolicy,
  projectMessages,
  now = () => new Date()
}: {
  repository: RoomHistoryRepository;
  cursorCodec: Pick<CursorCodec, 'encode' | 'decode'>;
  visibilityPolicy: VisibilityPolicy;
  /** Adds what a page's messages carry beyond their row, for the whole page at once. */
  projectMessages: (input: {
    messages: StoredRoomMessage[];
    roomId: string;
    access: Access;
  }) => Promise<StoredRoomMessage[]> | StoredRoomMessage[];
  now?: () => Date;
}) {
  function encodeTuple(roomId: string, tuple: CursorTuple, scope: 'history' | 'read' = 'history'): string {
    return cursorCodec.encode({ ...roomCursorScopes(roomId)[scope], tuple });
  }

  function toDto(roomId: string, message: StoredRoomMessage): RoomHistoryMessage {
    const tuple = { createdAtMicros: message.createdAtMicros, id: message.id };
    return {
      id: message.id,
      kind: 'room',
      createdAt: message.createdAt,
      author: {
        userId: message.authorUserId ?? null,
        peerId: message.peerId ?? '',
        name: message.name ?? '',
        avatarColorKey: message.avatarColorKey ?? null,
        avatarUrl: avatarUrl(message.avatarKey),
        avatarAccent: message.avatarAccent ?? null
      },
      content: message.content || { type: 'text', text: message.text ?? '' },
      editedAt: message.editedAt ?? null,
      expiresAt: message.expiresAt ?? null,
      ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
      ...(message.linkPreview == null ? {} : { linkPreview: message.linkPreview }),
      ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
      ...(message.replyPreview === undefined ? {} : { replyPreview: message.replyPreview }),
      ...(message.reactions === undefined ? {} : { reactions: message.reactions }),
      cursor: encodeTuple(roomId, tuple),
      readCursor: encodeTuple(roomId, tuple, 'read')
    };
  }

  async function getPage({
    roomId,
    query = {},
    access = { authorized: true }
  }: {
    roomId: string;
    query?: HistoryQueryInput;
    access?: Access;
  }): Promise<RoomHistoryPage> {
    const normalizedRoomId = roomId.trim();
    if (!normalizedRoomId) throw new DomainError('room_not_found', 404, 'Room not found');

    let normalizedQuery = query;
    if (query.mode === 'around' && !query.cursor && typeof query.messageId === 'string' && query.messageId.trim()) {
      const tuple = await repository.getAnchor({ roomId: normalizedRoomId, messageId: query.messageId.trim() });
      if (!tuple) throw new DomainError('message_not_found', 404, 'Message not found');
      normalizedQuery = { ...query, cursor: encodeTuple(normalizedRoomId, tuple) };
    }
    const parsed = normalizeHistoryRequest(normalizedQuery);
    if (!parsed.ok) throw new DomainError(parsed.code, 400, 'Invalid history cursor');
    if (!(await repository.roomExists(normalizedRoomId))) {
      throw new DomainError('room_not_found', 404, 'Room not found');
    }

    const { mode, limit, cursor } = parsed.request;
    const base = { roomId: normalizedRoomId, limit, now: now() };
    return pageHistory({
      mode,
      cursor,
      listLatest: () => repository.listLatest(base),
      listAnchored: (anchoredMode, anchor) =>
        repository[({ before: 'listBefore', after: 'listAfter', around: 'listAround' } as const)[anchoredMode]]({
          ...base,
          anchor
        }),
      decodeAnchor: (value) => cursorCodec.decode(value, roomCursorScopes(normalizedRoomId).history),
      invalidCursor: () => new DomainError('invalid_cursor', 400, 'Invalid history cursor'),
      canView: (message) =>
        visibilityPolicy.canViewRoomMessage({
          ...access,
          authorized: access?.authorized === true,
          message,
          roomId: message.roomId
        }),
      project: (visible) => projectMessages({ messages: visible, roomId: normalizedRoomId, access }),
      toDto: (message) => toDto(normalizedRoomId, message)
    });
  }

  return { getPage };
}

export { createRoomHistoryService };
