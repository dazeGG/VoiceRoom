export type AttachmentContext = 'room' | 'dm';
export type AttachmentState = 'pending' | 'processing' | 'ready' | 'failed' | 'deleted' | 'unavailable';
export type MessageAttachment = {
  id: string; context: AttachmentContext; ownerId: string; order: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: number;
  width: number; height: number; state: AttachmentState; url: string | null;
};
export const MAX_ATTACHMENTS: number;
export const MAX_ATTACHMENT_BYTES: number;
export function normalizeAttachment(value: unknown): MessageAttachment | null;
export function normalizeAttachments(value: unknown): MessageAttachment[] | null;
export function attachmentTextFallback(value: unknown, fallback?: string): string;
