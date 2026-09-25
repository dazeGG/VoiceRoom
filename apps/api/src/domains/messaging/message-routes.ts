import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ReplyTargetUnavailableError } from './reply-projector.ts';

const REPLY_CONFLICT_BODY = Object.freeze({
  error: 'reply_target_unavailable',
  message: 'Reply target is unavailable'
});

type RoomReplyRoute = { Params: { roomId: string; messageId: string }; Body: { text?: unknown } | null };
type DirectReplyRoute = { Params: { peerUserId: string; messageId: string }; Body: { text?: unknown } | null };
type ReplyInput = {
  request: FastifyRequest;
  targetMessageId: string;
  text: string;
  idempotencyKey: string | string[] | undefined;
};

export interface ReplyMessageService {
  replyToRoom(input: ReplyInput & { roomId: string }): Promise<unknown>;
  replyToDirect(input: ReplyInput & { peerUserId: string }): Promise<unknown>;
}

export type MessageReplyHandlers = Readonly<{
  directReply(request: FastifyRequest<DirectReplyRoute>, reply: FastifyReply): Promise<FastifyReply>;
  roomReply(request: FastifyRequest<RoomReplyRoute>, reply: FastifyReply): Promise<FastifyReply>;
}>;

function cleanText(value: unknown, maxLength = 4000): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text && text.length <= maxLength ? text : '';
}

function isUnavailableError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return (
    error instanceof ReplyTargetUnavailableError ||
    code === 'reply_target_unavailable' ||
    code === 'message_not_visible'
  );
}

function replyConflict(reply: FastifyReply): FastifyReply {
  return reply.code(409).send(REPLY_CONFLICT_BODY);
}

function createMessageReplyHandlers({
  messageService,
  maxTextLength = 4000
}: {
  messageService?: ReplyMessageService;
  maxTextLength?: number;
} = {}): MessageReplyHandlers {
  if (!messageService?.replyToRoom || !messageService?.replyToDirect) {
    throw new TypeError('Reply handlers require replyToRoom() and replyToDirect() operations');
  }
  const messages = messageService;

  async function roomReply(request: FastifyRequest<RoomReplyRoute>, reply: FastifyReply): Promise<FastifyReply> {
    const text = cleanText(request.body?.text, maxTextLength);
    if (!text) return reply.code(400).send({ error: 'invalid_message' });

    try {
      const message = await messages.replyToRoom({
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

  async function directReply(request: FastifyRequest<DirectReplyRoute>, reply: FastifyReply): Promise<FastifyReply> {
    const text = cleanText(request.body?.text, maxTextLength);
    if (!text) return reply.code(400).send({ error: 'invalid_message' });

    try {
      const message = await messages.replyToDirect({
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

function registerMessageReplyRoutes(
  fastify: FastifyInstance,
  options: {
    messageService?: ReplyMessageService;
    maxTextLength?: number;
  } = {}
): MessageReplyHandlers {
  if (!fastify || typeof fastify.post !== 'function') {
    throw new TypeError('A Fastify instance is required');
  }
  const handlers = createMessageReplyHandlers(options);
  fastify.post<RoomReplyRoute>('/api/rooms/:roomId/messages/:messageId/replies', handlers.roomReply);
  fastify.post<DirectReplyRoute>('/api/dm/:peerUserId/messages/:messageId/replies', handlers.directReply);
  return handlers;
}

export { REPLY_CONFLICT_BODY, createMessageReplyHandlers, registerMessageReplyRoutes };
