import { DomainError } from '../../platform/http/domain-error.ts';
import type { Attachment, AttachmentRepository } from './attachment.repository.ts';
import type { MediaQuotaRepository } from './media-quota.repository.ts';

const DEFAULT_MAX_PENDING = 8;
const DEFAULT_MAX_FILES_PER_WINDOW = 20;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

export type QuotaReservation = {
  ownerId: string;
  context: string;
  clientRequestId: string;
  bytes: unknown;
  metadata?: unknown;
};

function createMediaQuotaService({
  attachmentRepository: attachments,
  quotaRepository: quotas,
  maxPending = DEFAULT_MAX_PENDING,
  maxFilesPerWindow = DEFAULT_MAX_FILES_PER_WINDOW,
  maxBytes = DEFAULT_MAX_BYTES,
  reservationTtlMs = 60 * 60 * 1000
}: {
  attachmentRepository: Pick<AttachmentRepository, 'createDraft' | 'findByClientRequest'>;
  quotaRepository: Pick<MediaQuotaRepository, 'withOwnerReservation'>;
  maxPending?: number;
  maxFilesPerWindow?: number;
  maxBytes?: number;
  reservationTtlMs?: number;
}) {
  async function reserve({
    ownerId,
    context,
    clientRequestId,
    bytes,
    metadata
  }: QuotaReservation): Promise<Attachment | null> {
    const requestedBytes = Number(bytes);
    if (!Number.isSafeInteger(requestedBytes) || requestedBytes < 1) {
      throw new DomainError('media_size_invalid', 413, 'A positive upload size is required');
    }
    return quotas.withOwnerReservation(ownerId, async ({ client, usage }) => {
      const existing = clientRequestId
        ? await attachments.findByClientRequest(ownerId, context, clientRequestId, { client })
        : null;
      if (existing) return existing;
      if (usage.pendingCount >= maxPending)
        throw new DomainError('media_pending_limit', 413, 'Too many pending uploads');
      if (usage.recentCount >= maxFilesPerWindow)
        throw new DomainError('media_rate_limit', 413, 'Upload rate limit exceeded');
      if (usage.usedBytes + requestedBytes > maxBytes)
        throw new DomainError('media_byte_quota', 413, 'Media storage quota exceeded');
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

export { createMediaQuotaService };
