// The media domain wired together: attachments and their processing jobs,
// storage with its free-space pressure, per-owner quota, and who may see an
// attachment.

import type pg from 'pg';
import { recordMediaAuthorizationInvariantFailure, recordMediaPressure } from '../../lib/metrics.ts';
import { createAttachmentRepository } from './attachment.repository.ts';
import { createMediaAccessRepository } from './media-access.repository.ts';
import { createMediaJobRepository } from './media-job.repository.ts';
import { createMediaPressureService } from './media-pressure.service.ts';
import { createMediaQuotaRepository } from './media-quota.repository.ts';
import { createMediaQuotaService } from './media-quota.service.ts';
import { createMediaService } from './media.service.ts';
import { createMediaVisibilityService } from './media-visibility.service.ts';
import { createMediaStorage } from './storage.ts';

export interface MediaModuleDeps {
  pool: pg.Pool;
  storageDir: string;
  minFreeBytes: number;
  /** Whether every API replica agrees on readiness; uploads pause without it. */
  replicaConsensus: () => boolean;
  isBanned: (input: { roomId: string; userId: string }) => Promise<boolean>;
}

export function createMediaModule(deps: MediaModuleDeps) {
  const { pool } = deps;
  const storage = createMediaStorage({ rootDir: deps.storageDir });
  const pressure = createMediaPressureService({
    storagePath: storage.root,
    minFreeBytes: deps.minFreeBytes,
    replicaConsensus: deps.replicaConsensus,
    onSnapshot: recordMediaPressure
  });
  const attachments = createAttachmentRepository({ pool });
  const jobs = createMediaJobRepository({ pool });
  const quotaRepository = createMediaQuotaRepository({ attachmentRepository: attachments, pool });
  const quota = createMediaQuotaService({ attachmentRepository: attachments, quotaRepository });
  const service = createMediaService({
    attachmentRepository: attachments,
    jobRepository: jobs,
    pressureService: pressure,
    quotaService: quota,
    storage
  });
  const access = createMediaAccessRepository({ pool });
  const visibility = createMediaVisibilityService({
    attachmentRepository: attachments,
    storage,
    authorizeRoomAttachment: async ({ attachment, viewerId }) => {
      if (!attachment.roomMessageId) return false;
      const roomId = await access.roomOfVisibleRoomMessage({ messageId: attachment.roomMessageId, viewerId });
      if (!roomId) return false;
      return !(await deps.isBanned({ roomId, userId: viewerId }));
    },
    authorizeDirectAttachment: async ({ attachment, viewerId }) => {
      if (!attachment.directMessageId) return false;
      return access.canSeeDirectMessage({ messageId: attachment.directMessageId, viewerId });
    },
    onAuthorizationInvariantFailure: recordMediaAuthorizationInvariantFailure
  });
  return { attachments, jobs, pressure, quota, service, storage, visibility };
}

export type MediaModule = ReturnType<typeof createMediaModule>;
