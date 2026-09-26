// An attachment belongs to the account that uploaded it; only that account
// changes it or sees it before it is attached to a message.

export function ownsAttachment<Attachment extends { ownerId: string }>(
  attachment: Attachment | null | undefined,
  userId: string | null | undefined
): attachment is Attachment {
  return Boolean(attachment && userId && attachment.ownerId === userId);
}
