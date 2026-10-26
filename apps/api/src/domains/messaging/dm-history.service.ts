import type {
  Attachment,
  DirectHistoryMessage,
  DirectHistoryPage,
  InviteStatus,
  ReactionSummary,
  ReplyPointer,
  ReplyPreview
} from '@voice-room/shared/contracts/messages';
import { normalizeHistoryRequest } from '@voice-room/shared/messaging-history';
import { normalizeLinkPreview } from '@voice-room/shared/link-preview';
import type { CursorCodec, CursorTuple } from '../../platform/cursor-codec.ts';
import type { JsonObject } from '../../platform/db/schema.ts';
import { epochMillis } from '../../platform/epoch-millis.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import { canonicalParticipants, dmCursorScopes } from './cursor-scopes.ts';
import { pageHistory, type HistoryQueryInput } from './history-pager.ts';
import type { DirectVisibilityContext } from './message-visibility.service.ts';

/** A direct message as the history repository reads it; times are epoch milliseconds. */
export type StoredDirectMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  body?: string | undefined;
  createdAt: number;
  createdAtMicros: string;
  editedAt?: number | null | undefined;
  readAt?: number | null | undefined;
  /** The message's jsonb metadata column. */
  metadata?: JsonObject | null | undefined;
  attachments?: Attachment[] | undefined;
  replyTo?: ReplyPointer | null | undefined;
  replyPreview?: ReplyPreview | null | undefined;
  reactions?: ReactionSummary[] | undefined;
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const INVITE_STATUSES: readonly InviteStatus[] = ['pending', 'accepted', 'declined', 'expired'];

// Only what a client may read from the metadata: the room invitation and the
// link preview. Everything else in it stays server-side.
function publicMetadata(metadata: JsonObject | null | undefined): Exclude<DirectHistoryMessage['metadata'], undefined> {
  if (!metadata) return null;
  const roomId = text(metadata.roomId);
  const roomName = text(metadata.roomName);
  const status = INVITE_STATUSES.find((value) => value === metadata.status);
  const linkPreview = normalizeLinkPreview(metadata.linkPreview);
  return {
    ...(metadata.kind === 'room-invite' ? { kind: 'room-invite' as const } : {}),
    ...(roomId === undefined ? {} : { roomId }),
    ...(roomName === undefined ? {} : { roomName }),
    ...(status === undefined ? {} : { status }),
    ...(metadata.expiresAt === undefined ? {} : { expiresAt: epochMillis(metadata.expiresAt) }),
    ...(linkPreview ? { linkPreview } : {})
  };
}

type HistoryPage = { messages: StoredDirectMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean };
type ListInput = { userId: string; peerId: string; limit: number };
// Every mode except 'latest' decodes an anchor from its cursor first.
type AnchoredInput = ListInput & { anchor: CursorTuple };

export interface DmHistoryRepository {
  canReadThread(input: { userId: string; peerId: string }): Promise<boolean>;
  getAnchor(input: { userId: string; peerId: string; messageId: string }): Promise<CursorTuple | null>;
  listLatest(input: ListInput): Promise<HistoryPage>;
  listBefore(input: AnchoredInput): Promise<HistoryPage>;
  listAfter(input: AnchoredInput): Promise<HistoryPage>;
  listAround(input: AnchoredInput): Promise<HistoryPage>;
}

type VisibilityPolicy = {
  canViewDirectMessage(context: DirectVisibilityContext): boolean | Promise<boolean>;
};

function createDmHistoryService({
  repository,
  cursorCodec,
  visibilityPolicy,
  projectMessages
}: {
  repository: DmHistoryRepository;
  cursorCodec: Pick<CursorCodec, 'encode' | 'decode'>;
  visibilityPolicy: VisibilityPolicy;
  /** Adds what a page's messages carry beyond their row, for the whole page at once. */
  projectMessages: (input: {
    messages: StoredDirectMessage[];
    userId: string;
    peerId: string;
  }) => Promise<StoredDirectMessage[]> | StoredDirectMessage[];
}) {
  function encodeTuple(
    userId: string,
    peerId: string,
    tuple: CursorTuple,
    scope: 'history' | 'read' = 'history'
  ): string {
    return cursorCodec.encode({ ...dmCursorScopes(userId, peerId)[scope], tuple });
  }

  function toDto(userId: string, peerId: string, message: StoredDirectMessage): DirectHistoryMessage {
    const tuple = { createdAtMicros: message.createdAtMicros, id: message.id };
    const linkPreview = normalizeLinkPreview(message.metadata?.linkPreview);
    return {
      id: message.id,
      kind: 'dm',
      createdAt: message.createdAt,
      author: { userId: message.senderId },
      recipientId: message.recipientId,
      content: { type: 'text', text: message.body ?? '' },
      editedAt: message.editedAt ?? null,
      readAt: message.readAt ?? null,
      metadata: publicMetadata(message.metadata),
      ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
      ...(linkPreview ? { linkPreview } : {}),
      ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
      ...(message.replyPreview === undefined ? {} : { replyPreview: message.replyPreview }),
      ...(message.reactions === undefined ? {} : { reactions: message.reactions }),
      cursor: encodeTuple(userId, peerId, tuple),
      readCursor: encodeTuple(userId, peerId, tuple, 'read')
    };
  }

  async function getPage({
    userId,
    peerId,
    query = {}
  }: {
    userId: string;
    peerId: string;
    query?: HistoryQueryInput;
  }): Promise<DirectHistoryPage> {
    const viewer = userId.trim();
    const peer = peerId.trim();
    if (!viewer) throw new DomainError('authentication_required', 401, 'Authentication required');
    if (!peer || viewer === peer) throw new DomainError('thread_not_found', 404, 'Thread not found');

    if (!(await repository.canReadThread({ userId: viewer, peerId: peer }))) {
      throw new DomainError('thread_forbidden', 403, 'Thread is not available');
    }

    let normalizedQuery = query;
    if (query.mode === 'around' && !query.cursor && typeof query.messageId === 'string') {
      const messageId = query.messageId.trim();
      // Match the cursor tuple's ID bound and reject PostgreSQL's unsupported NUL.
      if (!messageId || Buffer.byteLength(messageId, 'utf8') > 160 || messageId.includes('\u0000')) {
        throw new DomainError('invalid_cursor', 400, 'Invalid history cursor');
      }
      const tuple = await repository.getAnchor({ userId: viewer, peerId: peer, messageId });
      if (!tuple) throw new DomainError('message_not_found', 404, 'Message not found');
      normalizedQuery = { ...query, cursor: encodeTuple(viewer, peer, tuple) };
    }
    const parsed = normalizeHistoryRequest(normalizedQuery);
    if (!parsed.ok) throw new DomainError(parsed.code, 400, 'Invalid history cursor');

    const { mode, limit, cursor } = parsed.request;
    const base = { userId: viewer, peerId: peer, limit };
    return pageHistory({
      mode,
      cursor,
      listLatest: () => repository.listLatest(base),
      listAnchored: (anchoredMode, anchor) =>
        repository[({ before: 'listBefore', after: 'listAfter', around: 'listAround' } as const)[anchoredMode]]({
          ...base,
          anchor
        }),
      decodeAnchor: (value) => cursorCodec.decode(value, dmCursorScopes(viewer, peer).history),
      invalidCursor: () => new DomainError('invalid_cursor', 400, 'Invalid history cursor'),
      canView: (message) => visibilityPolicy.canViewDirectMessage({ message, userId: viewer, viewerId: viewer }),
      project: (visible) => projectMessages({ messages: visible, userId: viewer, peerId: peer }),
      toDto: (message) => toDto(viewer, peer, message)
    });
  }

  return { getPage };
}

export { canonicalParticipants, createDmHistoryService };
