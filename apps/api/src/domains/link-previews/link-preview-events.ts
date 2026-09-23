// Link previews are built after a message was answered. Scheduling decides
// whether one is needed; when it is ready it reaches readers as an edit of the
// message, re-read in full so it carries its attachments and reply quote.

import { firstPreviewableUrl } from '@voice-room/shared/link-preview';
import type { MessageProjection } from '../messaging/message-projection.ts';

export interface LinkPreviewEventsDeps {
  previews(): {
    scheduleRoomMessage(input: { roomId: string; messageId: string; text: string }): unknown;
    scheduleDirectMessage(input: { messageId: string; senderId: string; recipientId: string; text: string }): unknown;
  } | null;
  roomMessage(roomId: string, messageId: string): Promise<{ id?: string; replyTo?: { messageId?: string } | null } | null>;
  directMessage(senderId: string, recipientId: string, messageId: string): Promise<{ id?: string; replyTo?: { messageId?: string } | null } | null>;
  projection: MessageProjection;
  publicChatMessage(message: unknown): unknown;
  /** Sends a room-detail envelope to voice peers and preview watchers. */
  broadcastRoomEdit(roomId: string, message: unknown): void;
  notifyUser(userId: string, event: Record<string, unknown>): void;
}

export function createLinkPreviewEvents(deps: LinkPreviewEventsDeps) {
  async function broadcastRoomLinkPreview({ roomId, messageId }: { roomId: string; messageId: string }): Promise<void> {
    const message = await deps.roomMessage(roomId, messageId);
    if (!message) return;
    const projected = await deps.projection.project('room', message, { roomId });
    deps.broadcastRoomEdit(roomId, deps.publicChatMessage(projected));
  }

  async function broadcastDirectLinkPreview({ messageId, senderId, recipientId }: { messageId: string; senderId: string; recipientId: string }): Promise<void> {
    const message = await deps.directMessage(senderId, recipientId, messageId);
    if (!message) return;
    const projected = await deps.projection.project('dm', message, { userId: senderId, peerId: recipientId });
    const event = { type: 'dm.message.edited', message: projected };
    deps.notifyUser(recipientId, event);
    deps.notifyUser(senderId, event);
  }

  // A new message without a link needs no work; an edit always does, because
  // it may have removed the link.
  function scheduleRoomLinkPreview(roomId: string, messageId: string, text: string, { edited = false }: { edited?: boolean } = {}): void {
    if (!edited && !firstPreviewableUrl(text)) return;
    deps.previews()?.scheduleRoomMessage({ roomId, messageId, text });
  }

  function scheduleDirectLinkPreview({ messageId, senderId, recipientId, text, edited = false }: { messageId: string; senderId: string; recipientId: string; text: string; edited?: boolean }): void {
    if (!edited && !firstPreviewableUrl(text)) return;
    deps.previews()?.scheduleDirectMessage({ messageId, senderId, recipientId, text });
  }

  return { broadcastRoomLinkPreview, broadcastDirectLinkPreview, scheduleRoomLinkPreview, scheduleDirectLinkPreview };
}

export type LinkPreviewEvents = ReturnType<typeof createLinkPreviewEvents>;
