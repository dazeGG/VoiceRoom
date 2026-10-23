import type { ReactionSummary, ReactorList } from '@voice-room/shared/contracts/messages';
import type pg from 'pg';
import {
  normalizeReactionMutation,
  normalizeReactionSummary,
  normalizeReactorPage,
  normalizeReactorQuery
} from '@voice-room/shared/reactions';
import { isRecord, textOf } from '@voice-room/shared/guards';
import type { CursorCodec } from '../../platform/cursor-codec.ts';
import { DomainError } from '../../platform/http/domain-error.ts';
import type { createReactionRepository } from './reaction.repository.ts';

type Conversation = { type: 'room' | 'dm'; id: string };
type Viewer = { id?: string; guest?: boolean; isGuest?: boolean; [key: string]: unknown } | null | undefined;
type Client = Pick<pg.PoolClient, 'query'>;

export type ReactionRepository = Pick<
  ReturnType<typeof createReactionRepository>,
  'getSummary' | 'listReactors' | 'listSummaries' | 'setDesiredState' | 'transaction'
>;

type VisibilityCheck = (input: {
  conversation: Conversation;
  messageId: string;
  viewer: Viewer;
  operation: 'read' | 'write';
}) => unknown;

export type ReactionEvent = {
  conversation: Conversation;
  messageId: string;
  actorUserId: string;
  summary: ReactionSummary;
};

function normalizeConversation(input: unknown): Conversation {
  const value = isRecord(input) ? input : {};
  const type = value.type === 'room' || value.type === 'dm' ? value.type : '';
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  if (!type || !id || id.length > 128) {
    throw new DomainError('invalid_conversation', 400, 'Invalid conversation');
  }
  return { type, id };
}

function createReactionService({
  repository,
  cursorCodec,
  requireVisible,
  publish
}: {
  repository: ReactionRepository;
  cursorCodec: Pick<CursorCodec, 'encode' | 'decode'>;
  requireVisible: VisibilityCheck;
  publish: (event: ReactionEvent) => unknown;
}) {
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
    const visible = await requireVisible({ conversation, messageId, viewer, operation });
    if (visible !== true) {
      throw new DomainError('message_not_visible', 404, 'Message is not visible');
    }
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
    const cleanMessageId = textOf(messageId).trim();
    if (!cleanMessageId) throw new DomainError('invalid_message', 400, 'Invalid message');
    await assertVisible({ conversation, messageId: cleanMessageId, viewer, operation: 'read' });
    const summaries = await repository.listSummaries({
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
    if (!mutation) throw new DomainError('invalid_reaction', 400, 'Invalid reaction');
    if (!viewer?.id || viewer.guest === true || viewer.isGuest === true) {
      throw new DomainError('account_required', 403, 'Account required');
    }
    const userId = viewer.id;
    await assertVisible({ conversation, messageId: mutation.messageId, viewer, operation: 'write' });

    const execute = async (client: Client) => {
      const result = await repository.setDesiredState({
        type: conversation.type,
        messageId: mutation.messageId,
        emoji: mutation.emoji,
        userId,
        active: mutation.active,
        client
      });
      const summary = await repository.getSummary({
        type: conversation.type,
        messageId: mutation.messageId,
        emoji: mutation.emoji,
        userId,
        client
      });
      return { changed: result.changed, summary: normalizeReactionSummary(summary) };
    };
    const result = await repository.transaction(execute);
    if (!result.summary) throw new Error('Repository returned an invalid reaction summary');

    if (result.changed) {
      await publish({
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
  } = {}): Promise<ReactorList> {
    const conversation = normalizeConversation(rawConversation);
    const normalizedMutation = normalizeReactionMutation({ messageId, emoji, active: true });
    const normalizedQuery = normalizeReactorQuery(query);
    if (!normalizedMutation || !normalizedQuery) {
      throw new DomainError('invalid_reactor_query', 400, 'Invalid reactor query');
    }
    await assertVisible({ conversation, messageId: normalizedMutation.messageId, viewer, operation: 'read' });

    const cursorContext = `${conversation.type}:${conversation.id}:${normalizedMutation.messageId}:${normalizedMutation.emoji}`;
    const after = normalizedQuery.cursor
      ? cursorCodec.decode(normalizedQuery.cursor, { purpose: 'reaction-reactors', context: cursorContext })
      : null;
    const rows = await repository.listReactors({
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
          ? cursorCodec.encode({
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

export type ReactionService = ReturnType<typeof createReactionService>;

export { createReactionService };
