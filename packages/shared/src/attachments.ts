// Image attachments on a message: at most four, each a processed JPEG, PNG
// or WebP with a stable order; the URL is only public once it is ready.

export type AttachmentContext = 'room' | 'dm';
export type AttachmentState = 'pending' | 'processing' | 'ready' | 'failed' | 'deleted' | 'unavailable';
export type MessageAttachment = {
  id: string;
  context: AttachmentContext;
  ownerId: string;
  order: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: number;
  width: number;
  height: number;
  state: AttachmentState;
  url: string | null;
};

export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = new Set<unknown>(['image/jpeg', 'image/png', 'image/webp']);
const STATES = new Set<unknown>(['pending', 'processing', 'ready', 'failed', 'deleted']);

function text(value: unknown, max = 128): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized && normalized.length <= max ? normalized : '';
}

export function normalizeAttachment(value: unknown): MessageAttachment | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const id = text(input.id);
  const context = input.context === 'room' || input.context === 'dm' ? input.context : '';
  const ownerId = text(input.ownerId);
  const mimeType = MIME_TYPES.has(input.mimeType) ? (input.mimeType as MessageAttachment['mimeType']) : '';
  const state = STATES.has(input.state) ? (input.state as AttachmentState) : 'unavailable';
  const order = Number(input.order);
  const bytes = Number(input.bytes);
  const width = Number(input.width);
  const height = Number(input.height);
  if (!id || !context || !ownerId || !mimeType) return null;
  if (!Number.isSafeInteger(order) || order < 0 || order >= MAX_ATTACHMENTS) return null;
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_ATTACHMENT_BYTES) return null;
  if (!Number.isSafeInteger(width) || width < 1 || width > 16_384) return null;
  if (!Number.isSafeInteger(height) || height < 1 || height > 16_384) return null;
  return {
    id,
    context,
    ownerId,
    order,
    mimeType,
    bytes,
    width,
    height,
    state,
    url: state === 'ready' && typeof input.url === 'string' ? input.url : null
  };
}

export function normalizeAttachments(values: unknown): MessageAttachment[] | null {
  if (!Array.isArray(values) || values.length > MAX_ATTACHMENTS) return null;
  const attachments = values.map(normalizeAttachment);
  if (attachments.some((attachment) => !attachment)) return null;
  const valid = attachments as MessageAttachment[];
  const orders = new Set(valid.map((attachment) => attachment.order));
  return orders.size === valid.length ? valid : null;
}

export function attachmentTextFallback(values: unknown, fallback: unknown = ''): string {
  const attachments = normalizeAttachments(values);
  if (!attachments?.length) return String(fallback || '');
  return String(fallback || '').trim() || `[Изображения: ${attachments.length}]`;
}
