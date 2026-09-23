import { REPLY_PREVIEW_TEXT_MAX_LENGTH, isSystemCard } from '@voice-room/shared/messaging-send';

const REPLY_TOMBSTONE_TEXT = 'Сообщение недоступно';

type Loose = Record<string, unknown>;
type ReplyAuthor = { id?: string; name?: string };

export type ReplyPreview = Readonly<{ messageId: string; deleted: boolean; author?: ReplyAuthor; text?: string }>;

class ReplyTargetUnavailableError extends Error {
  declare code: string;
  declare statusCode: number;

  constructor() {
    super('Reply target is unavailable');
    this.name = 'ReplyTargetUnavailableError';
    this.code = 'reply_target_unavailable';
    this.statusCode = 409;
  }
}

function toMillis(value: unknown): number | null {
  if (value == null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(value as string);
  return Number.isFinite(parsed) ? parsed : null;
}

function messageId(message: unknown): string {
  const value = message as Loose | null | undefined;
  return String(value?.id || value?.messageId || value?.message_id || '');
}

function isInvitation(message: Loose | null | undefined): boolean {
  const metadata = message?.metadata as Loose | null | undefined;
  return message?.invite != null
    || metadata?.kind === 'room-invite'
    || message?.kind === 'room-invite';
}

function isReplyTargetKindAllowed(input: unknown): boolean {
  const message = input as Loose | null | undefined;
  if (!message || !messageId(message)) return false;
  return !isInvitation(message) && !isSystemCard(message?.content ?? message?.kind ?? message?.type ?? message?.metadata);
}

function isUnavailable(input: unknown, now: number = Date.now()): boolean {
  const message = input as Loose | null | undefined;
  if (!message) return true;
  if (message.deleted === true || message.deletedAt || message.deleted_at) return true;
  const expiresAt = toMillis(message.expiresAt ?? message.expires_at);
  return expiresAt !== null && expiresAt <= now;
}

function projectAuthor(message: Loose): ReplyAuthor | undefined {
  const named = message.author as Loose | null | undefined;
  const id = message.authorUserId || message.author_user_id || message.senderId || message.sender_id || message.peerId || message.peer_id;
  const name = message.name || message.displayName || named?.name || named?.displayName;
  const author: ReplyAuthor = {};
  if (id) author.id = String(id);
  if (name) author.name = String(name);
  return Object.keys(author).length ? author : undefined;
}

function projectText(message: Loose): string | undefined {
  const value = message.text ?? message.body ?? (message.content as Loose | null | undefined)?.text;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, REPLY_PREVIEW_TEXT_MAX_LENGTH) : undefined;
}

function projectReplyTombstone(pointer: unknown): ReplyPreview {
  const id = typeof pointer === 'string' ? pointer : messageId(pointer);
  return Object.freeze({
    messageId: id,
    deleted: true,
    text: REPLY_TOMBSTONE_TEXT
  });
}

function projectReplyPreview(message: unknown, { now = Date.now() }: { now?: number } = {}): ReplyPreview | null {
  const id = messageId(message);
  if (!id) return null;
  if (isUnavailable(message, now)) return projectReplyTombstone(id);
  if (!isReplyTargetKindAllowed(message)) return null;

  // Intentionally omit replyTo/replyPreview: previews are exactly one level.
  const preview: { messageId: string; deleted: boolean; author?: ReplyAuthor; text?: string } = { messageId: id, deleted: false };
  const author = projectAuthor(message as Loose);
  const text = projectText(message as Loose);
  if (author) preview.author = author;
  if (text) preview.text = text;
  return Object.freeze(preview);
}

async function requireReplyTarget({ message, visibility, visibilityContext, now = Date.now() }: {
  message?: unknown;
  visibility?: boolean | ((context: Loose) => unknown);
  visibilityContext?: Loose;
  now?: number;
} = {}): Promise<ReplyPreview> {
  if (!isReplyTargetKindAllowed(message) || isUnavailable(message, now)) {
    throw new ReplyTargetUnavailableError();
  }

  const visible = typeof visibility === 'function'
    ? await visibility({ ...visibilityContext, message })
    : visibility === true;
  if (visible !== true) throw new ReplyTargetUnavailableError();

  const preview = projectReplyPreview(message, { now });
  if (!preview) throw new ReplyTargetUnavailableError();
  return preview;
}

export {
  REPLY_TOMBSTONE_TEXT,
  ReplyTargetUnavailableError,
  isReplyTargetKindAllowed,
  projectReplyPreview,
  projectReplyTombstone,
  requireReplyTarget
};
