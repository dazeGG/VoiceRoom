import type pg from 'pg';
import {
  normalizeReactionMutation,
  normalizeReactionSummary,
  normalizeReactorPage,
  normalizeReactorQuery,
  type ReactionMutation,
  type ReactionSummary,
  type ReactorPage
} from '@voice-room/shared/reactions';

type Conversation = { type: 'room' | 'dm'; id: string };
type Viewer = { id?: string; guest?: boolean; isGuest?: boolean; [key: string]: unknown } | null | undefined;
type Client = Pick<pg.PoolClient, 'query'> | null | undefined;
type ReactorTuple = { createdAtMicros: string; id: string };
type ReactorRow = { userId: string; displayName: string; avatarUrl: string | null; cursorTuple: ReactorTuple };

export interface ReactionRepository {
  setDesiredState(input: {
    type: string;
    messageId: string;
    emoji: string;
    userId: string;
    active: boolean;
    client: Client;
  }): Promise<{ changed: boolean; revision: string }>;
  getSummary(input: {
    type: string;
    messageId: string;
    emoji: string;
    userId: string;
    client: Client;
  }): Promise<unknown>;
  listSummaries(input: { type: string; messageId: string; userId: string | null }): Promise<unknown[]>;
  listReactors(input: {
    type: string;
    messageId: string;
    emoji: string;
    limit: number;
    after: ReactorTuple | null;
  }): Promise<ReactorRow[]>;
  transaction?<T>(callback: (client: Client) => Promise<T>): Promise<T>;
}

export interface ReactionCursorCodec {
  encode(input: { purpose: string; context: string; tuple: ReactorTuple }): string;
  decode(cursor: string, options: { purpose: string; context: string }): ReactorTuple;
}

type VisibilityCheck = (input: {
  conversation: Conversation;
  messageId: string;
  viewer: Viewer;
  operation: 'read' | 'write';
}) => unknown;
type WritesEnabled =
  boolean | ((context: { conversation: Conversation; mutation: ReactionMutation; viewer: Viewer }) => unknown);

export type ReactionEvent = {
  conversation: Conversation;
  messageId: string;
  actorUserId: string;
  summary: ReactionSummary;
};

class ReactionServiceError extends Error {
  declare code: string;
  declare statusCode: number;

  constructor(message: string, code: string, statusCode: number) {
    super(message);
    this.name = 'ReactionServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeConversation(input: unknown): Conversation {
  const value = input as { type?: unknown; id?: unknown } | null | undefined;
  const type = value?.type === 'room' || value?.type === 'dm' ? value.type : '';
  const id = typeof value?.id === 'string' ? value.id.trim() : '';
  if (!type || !id || id.length > 128) {
    throw new ReactionServiceError('Invalid conversation', 'invalid_conversation', 400);
  }
  return { type, id };
}

function createReactionService({
  repository,
  cursorCodec,
  requireVisible,
  writesEnabled = false,
  publish
}: {
  repository?: ReactionRepository;
  cursorCodec?: ReactionCursorCodec;
  requireVisible?: VisibilityCheck;
  writesEnabled?: WritesEnabled;
  publish?: (event: ReactionEvent) => unknown;
} = {}) {
  if (!repository?.setDesiredState || !repository?.listReactors) {
    throw new TypeError('Reaction repository is required');
  }
  if (!cursorCodec?.encode || !cursorCodec?.decode) {
    throw new TypeError('Reaction cursor codec is required');
  }
  const reactions = repository;
  const codec = cursorCodec;
  const visibility: VisibilityCheck = typeof requireVisible === 'function' ? requireVisible : async () => false;
  const publisher = typeof publish === 'function' ? publish : () => false;

  async function assertVisible({
    conversation,
    messageId,
    viewer,
    operation
  }: {
    conversation: Conversation;
    messageId: string;
    viewer: Viewer;
    operation: 'read' | 'write';
  }): Promise<void> {
    const visible = await visibility({ conversation, messageId, viewer, operation });
    if (visible !== true) {
      throw new ReactionServiceError('Message is not visible', 'message_not_visible', 404);
    }
  }

  async function canWrite(context: {
    conversation: Conversation;
    mutation: ReactionMutation;
    viewer: Viewer;
  }): Promise<boolean> {
    return typeof writesEnabled === 'function' ? (await writesEnabled(context)) === true : writesEnabled === true;
  }

  async function getSummaries({
    conversation: rawConversation,
    messageId,
    viewer
  }: {
    conversation?: unknown;
    messageId?: unknown;
    viewer?: Viewer;
  } = {}): Promise<ReactionSummary[]> {
    const conversation = normalizeConversation(rawConversation);
    const cleanMessageId = String(messageId || '').trim();
    if (!cleanMessageId) throw new ReactionServiceError('Invalid message', 'invalid_message', 400);
    await assertVisible({ conversation, messageId: cleanMessageId, viewer, operation: 'read' });
    const summaries = await reactions.listSummaries({
      type: conversation.type,
      messageId: cleanMessageId,
      userId: viewer?.id || null
    });
    return summaries.map(normalizeReactionSummary).filter((summary): summary is ReactionSummary => Boolean(summary));
  }

  async function setDesired({
    conversation: rawConversation,
    mutation: rawMutation,
    viewer
  }: {
    conversation?: unknown;
    mutation?: unknown;
    viewer?: Viewer;
  } = {}): Promise<ReactionSummary> {
    const conversation = normalizeConversation(rawConversation);
    const mutation = normalizeReactionMutation(rawMutation);
    if (!mutation) throw new ReactionServiceError('Invalid reaction', 'invalid_reaction', 400);
    if (!viewer?.id || viewer.guest === true || viewer.isGuest === true) {
      throw new ReactionServiceError('Account required', 'account_required', 403);
    }
    const userId = viewer.id;
    await assertVisible({ conversation, messageId: mutation.messageId, viewer, operation: 'write' });
    if (!(await canWrite({ conversation, mutation, viewer }))) {
      throw new ReactionServiceError('Reaction writes are disabled', 'reaction_write_disabled', 503);
    }

    const execute = async (client?: Client) => {
      const result = await reactions.setDesiredState({
        type: conversation.type,
        messageId: mutation.messageId,
        emoji: mutation.emoji,
        userId,
        active: mutation.active,
        client
      });
      const summary = await reactions.getSummary({
        type: conversation.type,
        messageId: mutation.messageId,
        emoji: mutation.emoji,
        userId,
        client
      });
      return { changed: result.changed, summary: normalizeReactionSummary(summary) };
    };
    const result = reactions.transaction ? await reactions.transaction(execute) : await execute();
    if (!result.summary) throw new Error('Repository returned an invalid reaction summary');

    if (result.changed) {
      await publisher({
        conversation,
        messageId: mutation.messageId,
        actorUserId: userId,
        summary: result.summary
      });
    }
    return result.summary;
  }

  async function getReactors({
    conversation: rawConversation,
    messageId,
    emoji,
    query,
    viewer
  }: {
    conversation?: unknown;
    messageId?: unknown;
    emoji?: unknown;
    query?: unknown;
    viewer?: Viewer;
  } = {}): Promise<ReactorPage> {
    const conversation = normalizeConversation(rawConversation);
    const normalizedMutation = normalizeReactionMutation({ messageId, emoji, active: true });
    const normalizedQuery = normalizeReactorQuery(query);
    if (!normalizedMutation || !normalizedQuery) {
      throw new ReactionServiceError('Invalid reactor query', 'invalid_reactor_query', 400);
    }
    await assertVisible({ conversation, messageId: normalizedMutation.messageId, viewer, operation: 'read' });

    const cursorContext = `${conversation.type}:${conversation.id}:${normalizedMutation.messageId}:${normalizedMutation.emoji}`;
    const after = normalizedQuery.cursor
      ? codec.decode(normalizedQuery.cursor, { purpose: 'reaction-reactors', context: cursorContext })
      : null;
    const rows = await reactions.listReactors({
      type: conversation.type,
      messageId: normalizedMutation.messageId,
      emoji: normalizedMutation.emoji,
      limit: normalizedQuery.limit + 1,
      after
    });
    const hasMore = rows.length > normalizedQuery.limit;
    const pageRows = hasMore ? rows.slice(0, normalizedQuery.limit) : rows;
    const last = pageRows.at(-1);
    const page = {
      reactors: pageRows.map(({ cursorTuple: _cursorTuple, ...reactor }) => reactor),
      nextCursor:
        hasMore && last
          ? codec.encode({
              purpose: 'reaction-reactors',
              context: cursorContext,
              tuple: last.cursorTuple
            })
          : null
    };
    const normalizedPage = normalizeReactorPage(page);
    if (!normalizedPage) throw new Error('Repository returned an invalid reactor page');
    return normalizedPage;
  }

  return Object.freeze({ getReactors, getSummaries, setDesired });
}

export { ReactionServiceError, createReactionService, normalizeConversation };
