// Sending a message: the conversation it goes to, the quote limit, system
// cards a reply may not target, and the delivery event the outbox emits.
// The reply pointer and quote are contracts/messages.ts.

import { isOneOf, isRecord, trimmedText } from './guards.ts';

const SEND_CONTRACT_VERSION = 1 as const;
export const REPLY_PREVIEW_TEXT_MAX_LENGTH = 280 as const;
export const DELIVERY_EVENT_TYPES: readonly ['message.created', 'message.updated', 'message.deleted'] = Object.freeze([
  'message.created',
  'message.updated',
  'message.deleted'
] as const);

export type ConversationRef = { type: 'room' | 'dm'; id: string };
export type MessageDeliveryEvent = {
  contractVersion: 1;
  eventId: string;
  type: 'message.created' | 'message.updated' | 'message.deleted';
  conversation: ConversationRef;
  messageId: string;
  cursor?: string | undefined;
  message?: Record<string, unknown> | undefined;
};

type Loose = Record<string, unknown>;

export function normalizeConversation(value: unknown): ConversationRef | null {
  if (!isRecord(value)) return null;
  const type = value.type === 'dm' ? 'dm' : value.type === 'room' ? 'room' : '';
  const id = trimmedText(value.id ?? value.roomId ?? value.userId ?? value.conversationId, 160);
  return type && id ? { type, id } : null;
}

export function isSystemCard(value: unknown): boolean {
  return (
    value === 'system' ||
    value === 'system-card' ||
    value === 'invite' ||
    (isRecord(value) && (value.type === 'system' || value.type === 'system-card' || value.system === true))
  );
}

export function buildMessageDeliveryEvent(value: Loose = {}): MessageDeliveryEvent | null {
  const eventId = trimmedText(value.eventId ?? value.id, 160);
  const messageId = trimmedText(value.messageId, 160);
  const conversation = normalizeConversation(value.conversation);
  const type = isOneOf(DELIVERY_EVENT_TYPES, value.type) ? value.type : '';
  if (!eventId || !messageId || !conversation || !type) return null;

  return {
    contractVersion: SEND_CONTRACT_VERSION,
    eventId,
    type,
    conversation,
    messageId,
    cursor: typeof value.cursor === 'string' && value.cursor ? value.cursor : undefined,
    message: isRecord(value.message) ? value.message : undefined
  };
}
