'use strict';

const DEFAULT_MAX_PENDING = 8;
const DEFAULT_MAX_FILES_PER_WINDOW = 20;
const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024;

class MediaQuotaError extends Error {
  constructor(code, message) {
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
} = {}) {
  if (!attachmentRepository?.createDraft || !quotaRepository?.withOwnerReservation) {
    throw new TypeError('Media quota repositories are required');
  }

  async function reserve({ ownerId, context, clientRequestId, bytes, metadata }) {
    const requestedBytes = Number(bytes);
    if (!Number.isSafeInteger(requestedBytes) || requestedBytes < 1) {
      throw new MediaQuotaError('media_size_invalid', 'A positive upload size is required');
    }
    return quotaRepository.withOwnerReservation(ownerId, async ({ client, usage }) => {
      const existing = clientRequestId
        ? await attachmentRepository.findByClientRequest(ownerId, context, clientRequestId, { client })
        : null;
      if (existing) return existing;
      if (usage.pendingCount >= maxPending) throw new MediaQuotaError('media_pending_limit', 'Too many pending uploads');
      if (usage.recentCount >= maxFilesPerWindow) throw new MediaQuotaError('media_rate_limit', 'Upload rate limit exceeded');
      if (usage.usedBytes + requestedBytes > maxBytes) throw new MediaQuotaError('media_byte_quota', 'Media storage quota exceeded');
      return attachmentRepository.createDraft({
        ownerId,
        context,
        clientRequestId,
        reservedBytes: requestedBytes,
        reservationExpiresAt: new Date(Date.now() + reservationTtlMs),
        metadata
      }, client);
    });
  }

  return Object.freeze({ reserve });
}

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_FILES_PER_WINDOW,
  DEFAULT_MAX_PENDING,
  DEFAULT_WINDOW_MS,
  MediaQuotaError,
  createMediaQuotaService
};
