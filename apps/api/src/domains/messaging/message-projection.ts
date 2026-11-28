// What a stored message carries when it leaves the API: its attachments
// (public fields only) and, for a reply, the quoted message preview.

import type { AttachmentContext, AttachmentState } from '@voiceroom/shared/contracts/media';
import type { Attachment, ReplyPreview } from '@voiceroom/shared/contracts/messages';
import { isRecord } from '@voiceroom/shared/guards';
import { attachmentFileName } from '../media/attachment.policy.ts';

type Context = 'room' | 'dm';

export interface StoredAttachment {
  id: string;
  context: AttachmentContext;
  order: number;
  mimeType: string | null;
  processedBytes?: number | null;
  originalBytes?: number | null;
  width?: number | null;
  height?: number | null;
  state: AttachmentState;
  [key: string]: unknown;
}

export interface MessageProjectionDeps {
  attachments(): {
    listForMessage(context: Context, messageId: string): Promise<StoredAttachment[]>;
    listForMessages(context: Context, messageIds: string[]): Promise<Map<string, StoredAttachment[]>>;
  } | null;
  replies(): {
    getRoomPreview(input: { roomId?: string | undefined; messageId: string }): Promise<ReplyPreview | null>;
    getDirectPreview(input: {
      userId?: string | undefined;
      peerId?: string | undefined;
      messageId: string;
    }): Promise<ReplyPreview | null>;
  } | null;
}

/** Where a ready attachment opens: an image's preview, or the diagnostics file's download. */
export function attachmentUrl(attachment: Pick<StoredAttachment, 'id' | 'state'>, file: boolean): string | null {
  if (attachment.state !== 'ready') return null;
  return `/api/media/attachments/${encodeURIComponent(attachment.id)}/${file ? 'file' : 'preview'}`;
}

/** The diagnostics file's name when the attachment is one, else null. */
export function storedFileName(attachment: StoredAttachment): string | null {
  return isRecord(attachment.metadata) ? attachmentFileName({ metadata: attachment.metadata }) : null;
}

// Never the owner or storage keys: an attachment is visible to everyone who
// can read the message. A diagnostics file also carries its name, so the
// client can show the file row.
export function publicAttachment(attachment: StoredAttachment): Attachment {
  const name = storedFileName(attachment);
  return {
    id: attachment.id,
    context: attachment.context,
    order: attachment.order,
    mimeType: attachment.mimeType,
    bytes: attachment.processedBytes || attachment.originalBytes || null,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    state: attachment.state,
    url: attachmentUrl(attachment, name !== null),
    kind: name === null ? 'image' : 'diagnostics',
    name
  };
}

export function createMessageProjection(deps: MessageProjectionDeps) {
  async function projectMedia<T extends { id?: string }>(
    context: Context,
    message: T
  ): Promise<T & { attachments: Attachment[] }> {
    const attachments = deps.attachments();
    if (!attachments || !message?.id) return { ...message, attachments: [] };
    const stored = await attachments.listForMessage(context, message.id);
    return { ...message, attachments: stored.map(publicAttachment) };
  }

  /** projectMedia for a whole page: one query instead of one per message. */
  async function projectMediaMany<T extends { id?: string }>(
    context: Context,
    messages: T[]
  ): Promise<Array<T & { attachments: Attachment[] }>> {
    const attachments = deps.attachments();
    const ids = messages.flatMap((message) => (message?.id ? [message.id] : []));
    const stored =
      attachments && ids.length
        ? await attachments.listForMessages(context, ids)
        : new Map<string, StoredAttachment[]>();
    return messages.map((message) => ({
      ...message,
      attachments: ((message?.id && stored.get(message.id)) || []).map(publicAttachment)
    }));
  }

  async function projectReply<T extends { replyTo?: { messageId?: string } | null | undefined }>(
    context: Context,
    message: T,
    {
      roomId,
      userId,
      peerId
    }: { roomId?: string | undefined; userId?: string | undefined; peerId?: string | undefined } = {}
  ): Promise<T | (T & { replyPreview: ReplyPreview | null })> {
    const messageId = message?.replyTo?.messageId;
    if (!messageId) return message;
    const replies = deps.replies();
    if (!replies) return message;
    const replyPreview =
      context === 'room'
        ? await replies.getRoomPreview({ roomId, messageId })
        : await replies.getDirectPreview({ userId, peerId, messageId });
    return { ...message, replyPreview };
  }

  /** Attachments first, then the reply quote: the shape every copy of a message has. */
  async function project<T extends { id?: string; replyTo?: { messageId?: string } | null | undefined }>(
    context: Context,
    message: T,
    options: { roomId?: string | undefined; userId?: string | undefined; peerId?: string | undefined } = {}
  ) {
    return projectReply(context, await projectMedia(context, message), options);
  }

  return { projectMedia, projectMediaMany, projectReply, project };
}

export type MessageProjection = ReturnType<typeof createMessageProjection>;
