export const SEND_CONTRACT_VERSION: 1;
export const IDEMPOTENCY_KEY_MIN_LENGTH: 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH: 160;
export const IDEMPOTENCY_FINGERPRINT_MAX_LENGTH: 256;
export const REPLY_PREVIEW_TEXT_MAX_LENGTH: 280;
export const DELIVERY_EVENT_TYPES: readonly ['message.created', 'message.updated', 'message.deleted'];

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

export function buildMessageDeliveryEvent(value?: Record<string, unknown>): MessageDeliveryEvent | null;
export function isSystemCard(value: unknown): boolean;
export function normalizeConversation(value: unknown): ConversationRef | null;
export function normalizeIdempotency(value: unknown): IdempotencyDescriptor | null;
export function normalizeReplyPointer(value: unknown): ReplyPointer | null;
export function normalizeReplyPreview(value: unknown): ReplyPreview | null;
export function normalizeSendEnvelope(value: unknown):
  | { ok: true; legacy: false; envelope: SendEnvelope }
  | { ok: true; legacy: true; envelope: null }
  | { ok: false; code: string };
