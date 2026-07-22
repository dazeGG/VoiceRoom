'use strict';

const { ReplyTargetUnavailableError } = require('./reply-projector');

const REPLY_CONFLICT_BODY = Object.freeze({
  error: 'reply_target_unavailable',
  message: 'Reply target is unavailable'
});

function cleanText(value, maxLength = 4000) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && text.length <= maxLength ? text : '';
}

function isUnavailableError(error) {
  return error instanceof ReplyTargetUnavailableError
    || error?.code === 'reply_target_unavailable'
    || error?.code === 'message_not_visible';
}

function replyConflict(reply) {
  return reply.code(409).send(REPLY_CONFLICT_BODY);
}

function createMessageReplyHandlers({ messageService, maxTextLength = 4000 } = {}) {
  if (!messageService?.replyToRoom || !messageService?.replyToDirect) {
    throw new TypeError('Reply handlers require replyToRoom() and replyToDirect() operations');
  }

  async function roomReply(request, reply) {
    const text = cleanText(request.body?.text, maxTextLength);
    if (!text) return reply.code(400).send({ error: 'invalid_message' });

    try {
      const message = await messageService.replyToRoom({
        request,
        roomId: request.params.roomId,
        targetMessageId: request.params.messageId,
        text,
        idempotencyKey: request.headers['idempotency-key']
      });
      if (!message) return replyConflict(reply);
      return reply.code(201).send({ message });
    } catch (error) {
      if (isUnavailableError(error)) return replyConflict(reply);
      throw error;
    }
  }

  async function directReply(request, reply) {
    const text = cleanText(request.body?.text, maxTextLength);
    if (!text) return reply.code(400).send({ error: 'invalid_message' });

    try {
      const message = await messageService.replyToDirect({
        request,
        peerUserId: request.params.peerUserId,
        targetMessageId: request.params.messageId,
        text,
        idempotencyKey: request.headers['idempotency-key']
      });
      if (!message) return replyConflict(reply);
      return reply.code(201).send({ message });
    } catch (error) {
      if (isUnavailableError(error)) return replyConflict(reply);
      throw error;
    }
  }

  return Object.freeze({ directReply, roomReply });
}

function registerMessageReplyRoutes(fastify, options = {}) {
  if (!fastify || typeof fastify.post !== 'function') {
    throw new TypeError('A Fastify instance is required');
  }
  const handlers = createMessageReplyHandlers(options);
  fastify.post('/api/rooms/:roomId/messages/:messageId/replies', handlers.roomReply);
  fastify.post('/api/dm/:peerUserId/messages/:messageId/replies', handlers.directReply);
  return handlers;
}

module.exports = {
  REPLY_CONFLICT_BODY,
  createMessageReplyHandlers,
  registerMessageReplyRoutes
};
