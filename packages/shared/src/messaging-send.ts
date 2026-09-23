// Sending a message: the conversation it goes to, the reply pointer and
// quote, the idempotency descriptor, and the delivery event the outbox emits.

export const SEND_CONTRACT_VERSION = 1 as const;
export const IDEMPOTENCY_KEY_MIN_LENGTH = 8 as const;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 160 as const;
export const IDEMPOTENCY_FINGERPRINT_MAX_LENGTH = 256 as const;
export const REPLY_PREVIEW_TEXT_MAX_LENGTH = 280 as const;
export const DELIVERY_EVENT_TYPES: readonly ['message.created', 'message.updated', 'message.deleted'] =
  Object.freeze(['message.created', 'message.updated', 'message.deleted'] as const);

export type ConversationRef = { type: 'room' | 'dm'; id: string };
export type ReplyPointer = Readonly<{ messageId: string }>;
export type ReplyPreview = {
  messageId: string;
  deleted: boolean;
  author?: Record<string, unknown>;
  text?: string;
};
export type IdempotencyDescriptor = {
  key: string;
  fingerprint: string;
  actorType: 'account' | 'guest';
  actorId: string;
  conversation: ConversationRef;
};
export type SendEnvelope = {
  contractVersion: 1;
  conversation: ConversationRef;
  content: unknown;
  replyTo?: ReplyPointer;
  idempotency: IdempotencyDescriptor;
};
export type MessageDeliveryEvent = {
  contractVersion: 1;
  eventId: string;
  type: 'message.created' | 'message.updated' | 'message.deleted';
  conversation: ConversationRef;
  messageId: string;
  cursor?: string;
  message?: Record<string, unknown>;
};

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : '';
}

export function normalizeConversation(value: unknown): ConversationRef | null {
  if (!isObject(value)) return null;
  const type = value.type === 'dm' ? 'dm' : value.type === 'room' ? 'room' : '';
  const id = cleanString(value.id ?? value.roomId ?? value.userId ?? value.conversationId, 160);
  return type && id ? { type, id } : null;
}

export function isSystemCard(value: unknown): boolean {
  return value === 'system'
    || value === 'system-card'
    || value === 'invite'
    || (isObject(value) && (value.type === 'system' || value.type === 'system-card' || value.system === true));
}

export function normalizeReplyPointer(value: unknown): ReplyPointer | null {
  if (!isObject(value)) return null;
  if (isSystemCard(value.content ?? value.kind ?? value.type)) return null;
  const messageId = cleanString(value.messageId ?? value.id, 160);
  return messageId ? Object.freeze({ messageId }) : null;
}

export function normalizeReplyPreview(value: unknown): ReplyPreview | null {
  if (!isObject(value)) return null;
  const messageId = cleanString(value.messageId ?? value.id, 160);
  if (!messageId) return null;
  const content = value.content as Loose | null | undefined;
  return {
    messageId,
    deleted: Boolean(value.deleted),
    author: isObject(value.author) ? value.author : undefined,
    text: cleanString(value.text ?? content?.text, REPLY_PREVIEW_TEXT_MAX_LENGTH) || undefined
  };
}

export function normalizeIdempotency(value: unknown): IdempotencyDescriptor | null {
  if (!isObject(value)) return null;
  const key = cleanString(value.key, IDEMPOTENCY_KEY_MAX_LENGTH);
  const fingerprint = cleanString(value.fingerprint, IDEMPOTENCY_FINGERPRINT_MAX_LENGTH);
  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || !fingerprint) return null;

  const actorType = value.actorType === 'guest' ? 'guest' : value.actorType === 'account' ? 'account' : '';
  const actorId = cleanString(value.actorId ?? value.peerId ?? value.userId, 160);
  const conversation = normalizeConversation(value.conversation);
  if (!actorType || !actorId || !conversation) return null;

  return { key, fingerprint, actorType, actorId, conversation };
}

export function normalizeSendEnvelope(value: unknown):
  | { ok: true; legacy: false; envelope: SendEnvelope }
  | { ok: true; legacy: true; envelope: null }
  | { ok: false; code: string } {
  if (!isObject(value)) return { ok: false, code: 'invalid_envelope' };
  if (value.contractVersion !== undefined && value.contractVersion !== SEND_CONTRACT_VERSION) {
    return { ok: true, legacy: true, envelope: null };
  }

  const conversation = normalizeConversation(value.conversation);
  if (!conversation) return { ok: false, code: 'invalid_conversation' };

  const content = value.content;
  if (isSystemCard(content)) return { ok: false, code: 'invalid_system_card_target' };

  const idempotency = normalizeIdempotency(value.idempotency);
  if (!idempotency) return { ok: false, code: 'invalid_idempotency' };

  const replyTo = value.replyTo === undefined || value.replyTo === null
    ? undefined
    : normalizeReplyPointer(value.replyTo);
  if (value.replyTo && !replyTo) return { ok: false, code: 'invalid_reply_target' };

  return {
    ok: true,
    legacy: false,
    envelope: {
      contractVersion: SEND_CONTRACT_VERSION,
      conversation,
      content,
      // A falsy non-null replyTo (0, '') passes through as null, as it always did.
      replyTo: replyTo as ReplyPointer | undefined,
      idempotency
    }
  };
}

export function buildMessageDeliveryEvent(value: Loose = {}): MessageDeliveryEvent | null {
  const eventId = cleanString(value.eventId ?? value.id, 160);
  const messageId = cleanString(value.messageId, 160);
  const conversation = normalizeConversation(value.conversation);
  const type = (DELIVERY_EVENT_TYPES as readonly unknown[]).includes(value.type) ? value.type as MessageDeliveryEvent['type'] : '';
  if (!eventId || !messageId || !conversation || !type) return null;

  return {
    contractVersion: SEND_CONTRACT_VERSION,
    eventId,
    type,
    conversation,
    messageId,
    cursor: typeof value.cursor === 'string' && value.cursor ? value.cursor : undefined,
    message: isObject(value.message) ? value.message : undefined
  };
}
