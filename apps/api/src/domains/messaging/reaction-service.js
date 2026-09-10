'use strict';

const {
  normalizeReactionMutation,
  normalizeReactionSummary,
  normalizeReactorPage,
  normalizeReactorQuery
} = require('@voice-room/shared/reactions');

class ReactionServiceError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'ReactionServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeConversation(value) {
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
} = {}) {
  if (!repository?.setDesiredState || !repository?.listReactors) {
    throw new TypeError('Reaction repository is required');
  }
  if (!cursorCodec?.encode || !cursorCodec?.decode) {
    throw new TypeError('Reaction cursor codec is required');
  }
  const visibility = typeof requireVisible === 'function' ? requireVisible : async () => false;
  const publisher = typeof publish === 'function' ? publish : () => false;

  async function assertVisible({ conversation, messageId, viewer, operation }) {
    const visible = await visibility({ conversation, messageId, viewer, operation });
    if (visible !== true) {
      throw new ReactionServiceError('Message is not visible', 'message_not_visible', 404);
    }
  }

  async function canWrite(context) {
    return typeof writesEnabled === 'function'
      ? (await writesEnabled(context)) === true
      : writesEnabled === true;
  }

  async function getSummaries({ conversation: rawConversation, messageId, viewer } = {}) {
    const conversation = normalizeConversation(rawConversation);
    const cleanMessageId = String(messageId || '').trim();
    if (!cleanMessageId) throw new ReactionServiceError('Invalid message', 'invalid_message', 400);
    await assertVisible({ conversation, messageId: cleanMessageId, viewer, operation: 'read' });
    const summaries = await repository.listSummaries({
      type: conversation.type,
      messageId: cleanMessageId,
      userId: viewer?.id || null
    });
    return summaries.map(normalizeReactionSummary).filter(Boolean);
  }

  async function setDesired({ conversation: rawConversation, mutation: rawMutation, viewer } = {}) {
    const conversation = normalizeConversation(rawConversation);
    const mutation = normalizeReactionMutation(rawMutation);
    if (!mutation) throw new ReactionServiceError('Invalid reaction', 'invalid_reaction', 400);
    if (!viewer?.id || viewer.guest === true || viewer.isGuest === true) {
      throw new ReactionServiceError('Account required', 'account_required', 403);
    }
    await assertVisible({ conversation, messageId: mutation.messageId, viewer, operation: 'write' });
    if (!(await canWrite({ conversation, mutation, viewer }))) {
      throw new ReactionServiceError('Reaction writes are disabled', 'reaction_write_disabled', 503);
    }

    const execute = async (client) => {
      const result = await repository.setDesiredState({
        type: conversation.type,
        messageId: mutation.messageId,
        emoji: mutation.emoji,
        userId: viewer.id,
        active: mutation.active,
        client
      });
      const summary = await repository.getSummary({
        type: conversation.type,
        messageId: mutation.messageId,
        emoji: mutation.emoji,
        userId: viewer.id,
        client
      });
      return { changed: result.changed, summary: normalizeReactionSummary(summary) };
    };
    const result = repository.transaction
      ? await repository.transaction(execute)
      : await execute();
    if (!result.summary) throw new Error('Repository returned an invalid reaction summary');

    if (result.changed) {
      await publisher({
        conversation,
        messageId: mutation.messageId,
        actorUserId: viewer.id,
        summary: result.summary
      });
    }
    return result.summary;
  }

  async function getReactors({ conversation: rawConversation, messageId, emoji, query, viewer } = {}) {
    const conversation = normalizeConversation(rawConversation);
    const normalizedMutation = normalizeReactionMutation({ messageId, emoji, active: true });
    const normalizedQuery = normalizeReactorQuery(query);
    if (!normalizedMutation || !normalizedQuery) {
      throw new ReactionServiceError('Invalid reactor query', 'invalid_reactor_query', 400);
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
      reactors: pageRows.map(({ cursorTuple: ignored, ...reactor }) => reactor),
      nextCursor: hasMore && last
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

module.exports = {
  ReactionServiceError,
  createReactionService,
  normalizeConversation
};
