// What an account may report. Who reviews reports is a staff permission (domains/staff).

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
