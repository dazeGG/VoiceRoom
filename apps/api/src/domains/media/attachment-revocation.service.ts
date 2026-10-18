// Deleting a message takes its attachments with it: each one is denied, then
// its stored files are queued for cleanup, all on the deletion's own
// connection so the message and its attachments go together or not at all.
// Room and direct message deletion by the author and by moderation share it.

import type pg from 'pg';
import type { Attachment, AttachmentContext, AttachmentRepository } from './attachment.repository.ts';
import type { MediaJobRepository } from './media-job.repository.ts';

/** What revoking a message's attachments needs from the attachment store. */
export type RevocableAttachments = Pick<AttachmentRepository, 'listForMessage' | 'markDeleted'>;
/** What queueing their cleanup needs from the media job queue. */
export type CleanupJobs = Pick<MediaJobRepository, 'enqueue'>;
/** Runs on the deletion's connection, after the message is gone. */
export type DeleteUnitOfWork = (client: Pick<pg.PoolClient, 'query'>) => Promise<void>;

/** The deletion step that revokes the message's attachments; null when media is off. */
export function revokeAttachmentsOnDelete(
  media: { attachments: RevocableAttachments; jobs: CleanupJobs } | null,
  context: AttachmentContext,
  messageId: string
): DeleteUnitOfWork | null {
  if (!media) return null;
  return (client) =>
    revokeMessageAttachments({ attachments: media.attachments, jobs: media.jobs, context, messageId, client });
}

export async function revokeMessageAttachments({
  attachments,
  jobs,
  context,
  messageId,
  client,
  at = new Date()
}: {
  attachments: RevocableAttachments;
  jobs: CleanupJobs;
  context: AttachmentContext;
  messageId: string;
  client: Pick<pg.PoolClient, 'query'>;
  at?: Date;
}): Promise<void> {
  const revoked: Array<Attachment | null> = [];
  for (const attachment of await attachments.listForMessage(context, messageId, { client })) {
    revoked.push(await attachments.markDeleted(attachment.id, client));
  }
  for (const attachment of revoked) {
    if (attachment) await jobs.enqueue(attachment.id, { kind: 'cleanup', availableAt: at, client });
  }
}
