// A direct message is visible to its two users and changed only by its sender.

type DirectMessage = { senderId: string; recipientId: string };

export function isDirectParticipant(message: DirectMessage, userId: string | null | undefined): boolean {
  return Boolean(userId) && (message.senderId === userId || message.recipientId === userId);
}

export function isDirectSender(message: DirectMessage, userId: string | null | undefined): boolean {
  return Boolean(userId) && message.senderId === userId;
}
