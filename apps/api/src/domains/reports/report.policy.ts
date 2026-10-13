// Who may review reports and what an account may report.

/** A platform administrator is an account the operator named in PLATFORM_ADMIN_USER_IDS. */
export function isPlatformAdmin(adminUserIds: readonly string[], userId: string | null | undefined): boolean {
  return Boolean(userId && adminUserIds.includes(userId));
}

/**
 * A direct message can be reported by its recipient only: the sender can
 * delete it, and nobody else can see it.
 */
export function canReportDirectMessage(
  message: { senderId: string; recipientId: string } | null | undefined,
  userId: string
): 'allowed' | 'not_visible' | 'own_message' {
  if (!message) return 'not_visible';
  if (message.senderId === userId) return 'own_message';
  return message.recipientId === userId ? 'allowed' : 'not_visible';
}
