// How a room invitation reads in a direct thread, for the side that sent it
// and the side that got it.

import { t } from '@/shared/i18n';
import type { DirectMessageInvite } from '@/api/dm';

function expired(invite: DirectMessageInvite, now: number): boolean {
  return Boolean(invite.expiresAt && invite.expiresAt <= now);
}

export function inviteTitle(invite: DirectMessageInvite, fromMe: boolean, now = Date.now()): string {
  if (invite.status === 'accepted') return t('Принял приглашение');
  if (invite.status === 'declined') return t('Отклонил предложение');
  if (invite.status === 'expired') return t('Приглашение завершено');
  if (expired(invite, now)) return t('Приглашение истекло');
  return fromMe ? t('Приглашение отправлено') : t('Приглашение в комнату');
}

/** Only the invited side answers, and only a pending invitation that has not run out. */
export function inviteAnswerable(invite: DirectMessageInvite, fromMe: boolean, now = Date.now()): boolean {
  return !fromMe && invite.status === 'pending' && !expired(invite, now);
}
