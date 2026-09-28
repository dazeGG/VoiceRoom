// How a room invitation reads in a direct thread, for the side that sent it
// and the side that got it.

import type { DirectMessageInvite } from '$lib/api/dm';

function expired(invite: DirectMessageInvite, now: number): boolean {
  return Boolean(invite.expiresAt && invite.expiresAt <= now);
}

export function inviteTitle(invite: DirectMessageInvite, fromMe: boolean, now = Date.now()): string {
  if (invite.status === 'accepted') return 'Принял приглашение';
  if (invite.status === 'declined') return 'Отклонил предложение';
  if (invite.status === 'expired') return 'Приглашение завершено';
  if (expired(invite, now)) return 'Приглашение истекло';
  return fromMe ? 'Приглашение отправлено' : 'Приглашение в комнату';
}

/** Only the invited side answers, and only a pending invitation that has not run out. */
export function inviteAnswerable(invite: DirectMessageInvite, fromMe: boolean, now = Date.now()): boolean {
  return !fromMe && invite.status === 'pending' && !expired(invite, now);
}
