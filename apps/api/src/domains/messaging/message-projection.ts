// What a stored message carries when it leaves the API: its attachments
// (public fields only) and, for a reply, the quoted message preview.

type Context = 'room' | 'dm';

export interface StoredAttachment {
  id: string;
  context: string;
  order: number;
  mimeType: string;
  processedBytes?: number | null;
  originalBytes?: number | null;
  width?: number | null;
  height?: number | null;
  state: string;
  [key: string]: unknown;
}

export interface MessageProjectionDeps {
  attachments(): { listForMessage(context: Context, messageId: string): Promise<StoredAttachment[]> } | null;
  replies(): {
    getRoomPreview(input: { roomId?: string; messageId: string }): Promise<unknown>;
    getDirectPreview(input: { userId?: string; peerId?: string; messageId: string }): Promise<unknown>;
  } | null;
}

// Never the owner or storage keys: an attachment is visible to everyone who
// can read the message.
export function publicAttachment(attachment: StoredAttachment) {
  return {
    id: attachment.id,
    context: attachment.context,
    order: attachment.order,
    mimeType: attachment.mimeType,
    bytes: attachment.processedBytes || attachment.originalBytes,
    width: attachment.width,
    height: attachment.height,
    state: attachment.state,
    url: attachment.state === 'ready' ? `/api/media/attachments/${encodeURIComponent(attachment.id)}/preview` : null
  };
}

export function createMessageProjection(deps: MessageProjectionDeps) {
  async function projectMedia<T extends { id?: string }>(context: Context, message: T): Promise<T & { attachments: ReturnType<typeof publicAttachment>[] }> {
    const attachments = deps.attachments();
    if (!attachments || !message?.id) return { ...message, attachments: [] };
    const stored = await attachments.listForMessage(context, message.id);
    return { ...message, attachments: stored.map(publicAttachment) };
  }

  async function projectReply<T extends { replyTo?: { messageId?: string } | null }>(
    context: Context,
    message: T,
    { roomId, userId, peerId }: { roomId?: string; userId?: string; peerId?: string } = {}
  ): Promise<T | (T & { replyPreview: unknown })> {
    const messageId = message?.replyTo?.messageId;
    if (!messageId) return message;
    const replies = deps.replies();
    if (!replies) return message;
    const replyPreview = context === 'room'
      ? await replies.getRoomPreview({ roomId, messageId })
      : await replies.getDirectPreview({ userId, peerId, messageId });
    return { ...message, replyPreview };
  }

  /** Attachments first, then the reply quote: the shape every copy of a message has. */
  async function project<T extends { id?: string; replyTo?: { messageId?: string } | null }>(context: Context, message: T, options: { roomId?: string; userId?: string; peerId?: string } = {}) {
    return projectReply(context, await projectMedia(context, message), options);
  }

  return { projectMedia, projectReply, project };
}

export type MessageProjection = ReturnType<typeof createMessageProjection>;
