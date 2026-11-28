import { DIAGNOSTICS_FILE_NAME_PATTERN } from '@voiceroom/shared/contracts/media';

// An attachment belongs to the account that uploaded it; only that account
// changes it or sees it before it is attached to a message.

export function ownsAttachment<Attachment extends { ownerId: string }>(
  attachment: Attachment | null | undefined,
  userId: string | null | undefined
): attachment is Attachment {
  return Boolean(attachment && userId && attachment.ownerId === userId);
}

// A slot reserved for the diagnostics file says so in its metadata; every
// other attachment is an image.
export function isDiagnosticsAttachment(attachment: { metadata: Record<string, unknown> }): boolean {
  return attachment.metadata.kind === 'diagnostics';
}

/** The diagnostics file's stored name, or null (an image, or a file not uploaded yet). */
export function attachmentFileName(attachment: { metadata: Record<string, unknown> }): string | null {
  const name = attachment.metadata.originalName;
  return isDiagnosticsAttachment(attachment) && typeof name === 'string' && DIAGNOSTICS_FILE_NAME_PATTERN.test(name)
    ? name
    : null;
}
