import type { Attachment, AttachmentRepository } from './attachment-repository.ts';
import type { MediaQuotaRepository } from './media-quota-repository.ts';

const DEFAULT_MAX_PENDING = 8;
const DEFAULT_MAX_FILES_PER_WINDOW = 20;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

export type QuotaReservation = {
  ownerId: string;
  context: string;
  clientRequestId: string;
  bytes: unknown;
  metadata?: unknown;
};

class MediaQuotaError extends Error {
  declare code: string;
  declare statusCode: number;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MediaQuotaError';
    this.code = code;
    this.statusCode = 413;
  }
}

function createMediaQuotaService({
  attachmentRepository,
  quotaRepository,
  maxPending = DEFAULT_MAX_PENDING,
  maxFilesPerWindow = DEFAULT_MAX_FILES_PER_WINDOW,
  maxBytes = DEFAULT_MAX_BYTES,
  reservationTtlMs = 60 * 60 * 1000
}: {
  attachmentRepository?: Pick<AttachmentRepository, 'createDraft' | 'findByClientRequest'>;
  quotaRepository?: MediaQuotaRepository;
  maxPending?: number;
  maxFilesPerWindow?: number;
  maxBytes?: number;
  reservationTtlMs?: number;
} = {}) {
  if (!attachmentRepository?.createDraft || !quotaRepository?.withOwnerReservation) {
    throw new TypeError('Media quota repositories are required');
  }
  const attachments = attachmentRepository;
  const quotas = quotaRepository;

  async function reserve({
    ownerId,
    context,
    clientRequestId,
    bytes,
    metadata
  }: QuotaReservation): Promise<Attachment | null> {
    const requestedBytes = Number(bytes);
    if (!Number.isSafeInteger(requestedBytes) || requestedBytes < 1) {
      throw new MediaQuotaError('media_size_invalid', 'A positive upload size is required');
    }
    return quotas.withOwnerReservation(ownerId, async ({ client, usage }) => {
      const existing = clientRequestId
        ? await attachments.findByClientRequest(ownerId, context, clientRequestId, { client })
        : null;
      if (existing) return existing;
      if (usage.pendingCount >= maxPending)
        throw new MediaQuotaError('media_pending_limit', 'Too many pending uploads');
      if (usage.recentCount >= maxFilesPerWindow)
        throw new MediaQuotaError('media_rate_limit', 'Upload rate limit exceeded');
      if (usage.usedBytes + requestedBytes > maxBytes)
        throw new MediaQuotaError('media_byte_quota', 'Media storage quota exceeded');
      return attachments.createDraft(
        {
          ownerId,
          context,
          clientRequestId,
          reservedBytes: requestedBytes,
          reservationExpiresAt: new Date(Date.now() + reservationTtlMs),
          metadata
        },
        client
      );
    });
  }

  return Object.freeze({ reserve });
}

export type MediaQuotaService = ReturnType<typeof createMediaQuotaService>;

export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES_PER_WINDOW,
  DEFAULT_MAX_PENDING,
  DEFAULT_WINDOW_MS,
  MediaQuotaError,
  createMediaQuotaService
};
