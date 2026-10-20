import type { ErrorCode } from '@voice-room/shared/contracts/errors';
import type {
  Attachment,
  DirectHistoryMessage,
  DirectHistoryPage,
  InviteStatus,
  ReactionSummary,
  ReplyPointer,
  ReplyPreview
} from '@voice-room/shared/contracts/messages';
import { textOf } from '@voice-room/shared/guards';
import { normalizeHistoryRequest } from '@voice-room/shared/messaging-history';
import { normalizeLinkPreview } from '@voice-room/shared/link-preview';
import { epochMillis } from '../../platform/epoch-millis.ts';
import { isDirectParticipant } from './direct-message.policy.ts';

type Tuple = { createdAtMicros: unknown; id: string };
type Loose = Record<string, unknown>;

/** A direct message as the history repository reads it; times come as the driver returns them. */
export type StoredDirectMessage = {
  id: string;
  senderId: string;
  recipientId: string;
  body?: string | undefined;
  createdAt: unknown;
  createdAtMicros: unknown;
  editedAt?: unknown;
  readAt?: unknown;
  metadata?: Loose | null | undefined;
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
function publicMetadata(metadata: Loose | null | undefined): Exclude<DirectHistoryMessage['metadata'], undefined> {
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
type ListInput = { userId: string; peerId: string; anchor: Tuple | undefined; limit: number };
// Every mode except 'latest' decodes an anchor from its cursor first.
type AnchoredInput = Omit<ListInput, 'anchor'> & { anchor: Tuple };

export interface DmHistoryRepository {
  canReadThread(input: { userId: string; peerId: string }): Promise<boolean>;
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
  canViewDirectMessage?(context: Loose): boolean | Promise<boolean>;
  requireDirectMessage?(context: Loose): unknown;
};

class DmHistoryError extends Error {
  declare code: ErrorCode;
  declare statusCode: number;

  constructor(code: ErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = 'DmHistoryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function canonicalParticipants(userId: string, peerId: string): [string, string] {
  return userId < peerId ? [userId, peerId] : [peerId, userId];
}

function createDmHistoryService({
  repository,
  cursorCodec,
  visibilityPolicy,
  projectMessages
}: {
  repository?: DmHistoryRepository;
  cursorCodec?: HistoryCursorCodec;
  visibilityPolicy?: VisibilityPolicy;
  /** Adds what a page's messages carry beyond their row, for the whole page at once. */
  projectMessages?: (input: {
    messages: StoredDirectMessage[];
    userId: string;
    peerId: string;
  }) => Promise<StoredDirectMessage[]> | StoredDirectMessage[];
} = {}) {
  if (!repository) throw new TypeError('DM history repository is required');
  if (!cursorCodec?.encode || !cursorCodec?.decode) throw new TypeError('cursor codec is required');
  const history = repository;
  const codec = cursorCodec;

  function contextFor(userId: string, peerId: string): string {
    return `dm:${canonicalParticipants(userId, peerId).join(':')}`;
  }

  function encodeTuple(userId: string, peerId: string, tuple: Tuple, purpose = 'dm-history'): string {
    return codec.encode({ purpose, context: contextFor(userId, peerId), tuple });
  }

  function decodeTuple(userId: string, peerId: string, cursor: string | undefined): Tuple {
    return codec.decode(cursor, { purpose: 'dm-history', context: contextFor(userId, peerId) });
  }

  function canView(message: StoredDirectMessage, userId: string): boolean | Promise<boolean> {
    if (!visibilityPolicy) {
      return isDirectParticipant(message, userId);
    }
    const context = { message, userId, viewerId: userId };
    if (typeof visibilityPolicy.canViewDirectMessage === 'function') {
      return visibilityPolicy.canViewDirectMessage(context);
    }
    if (typeof visibilityPolicy.requireDirectMessage === 'function') {
      visibilityPolicy.requireDirectMessage(context);
    }
    return true;
  }

  function toDto(userId: string, peerId: string, message: StoredDirectMessage): DirectHistoryMessage {
    const tuple = { createdAtMicros: message.createdAtMicros, id: message.id };
    const linkPreview = normalizeLinkPreview(message.metadata?.linkPreview);
    return {
      id: message.id,
      kind: 'dm',
      createdAt: epochMillis(message.createdAt),
      author: { userId: message.senderId },
      recipientId: message.recipientId,
      content: { type: 'text', text: message.body ?? '' },
      editedAt: epochMillis(message.editedAt),
      readAt: epochMillis(message.readAt),
      metadata: publicMetadata(message.metadata),
      ...(message.attachments === undefined ? {} : { attachments: message.attachments }),
      ...(linkPreview ? { linkPreview } : {}),
      ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
      ...(message.replyPreview === undefined ? {} : { replyPreview: message.replyPreview }),
      ...(message.reactions === undefined ? {} : { reactions: message.reactions }),
      cursor: encodeTuple(userId, peerId, tuple),
      readCursor: encodeTuple(userId, peerId, tuple, 'dm-read')
    };
  }

  async function getPage({
    userId,
    peerId,
    query = {}
  }: { userId?: unknown; peerId?: unknown; query?: Loose } = {}): Promise<DirectHistoryPage> {
    const viewer = textOf(userId).trim();
    const peer = textOf(peerId).trim();
    if (!viewer) throw new DmHistoryError('authentication_required', 401, 'Authentication required');
    if (!peer || viewer === peer) throw new DmHistoryError('thread_not_found', 404, 'Thread not found');

    const parsed = normalizeHistoryRequest(query);
    if (!parsed.ok) throw new DmHistoryError(parsed.code, 400, 'Invalid history cursor');
    if (!(await history.canReadThread({ userId: viewer, peerId: peer }))) {
      throw new DmHistoryError('thread_forbidden', 403, 'Thread is not available');
    }

    const { mode, limit, cursor } = parsed.request;
    const base = { userId: viewer, peerId: peer, limit };
    let page: HistoryPage;
    if (mode === 'latest') {
      page = await history.listLatest({ ...base, anchor: undefined });
    } else {
      let anchor: Tuple;
      try {
        anchor = decodeTuple(viewer, peer, cursor);
      } catch {
        throw new DmHistoryError('invalid_cursor', 400, 'Invalid history cursor');
      }
      const method = ({ before: 'listBefore', after: 'listAfter', around: 'listAround' } as const)[mode];
      page = await history[method]({ ...base, anchor });
    }
    const visible: StoredDirectMessage[] = [];
    for (const message of page.messages) {
      if (await canView(message, viewer)) visible.push(message);
    }
    const projected =
      typeof projectMessages === 'function' && visible.length > 0
        ? await projectMessages({ messages: visible, userId: viewer, peerId: peer })
        : visible;
    const messages = projected.map((message) => toDto(viewer, peer, message));
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

export { DmHistoryError, canonicalParticipants, createDmHistoryService };
