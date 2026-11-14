import { getLocale, t } from '@/shared/i18n';
import { localeTag } from '@voice-room/shared/localization';
import { RECOVERY_CODE_COUNT, isRecoveryCodesReminderDue } from '@voice-room/shared/account-security';
import { dayMonthYear, timeAgo } from '@/shared/utils/date-format';
import type { AccountSecurity, AccountSession, RecoveryCodesStatus } from '@/api/auth';

const HOUR_MS = 60 * 60 * 1000;

export function sessionDeviceLabel(session: Pick<AccountSession, 'client' | 'os'>): string {
  const client = session.client || t('Неизвестный браузер');
  return session.os ? `${client} · ${session.os}` : client;
}

// The server refreshes a session's last visit at most once an hour, so anything
// more precise than "within the hour" would be made up.
export function formatLastSeen(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < HOUR_MS) return t('Активен в течение часа');
  return t('Заходил {p0}', { p0: timeAgo(timestamp, now) });
}

export function recoveryCodesSummary(status: RecoveryCodesStatus): string {
  if (status.remaining === 0) {
    return status.generatedAt
      ? t('Все коды использованы. Создайте новые, иначе забытый пароль не восстановить.')
      : t('Кодов пока нет. Без них забытый пароль не восстановить.');
  }
  const created = status.generatedAt ? t(' · созданы {p0}', { p0: dayMonthYear(status.generatedAt) }) : '';
  return t('Осталось {p0} из {p1}{p2}', {
    p0: status.remaining,
    p1: RECOVERY_CODE_COUNT,
    p2: created
  });
}

export function recoveryCodesFileText(codes: string[], login: string, createdAt = new Date()): string {
  return [
    t('VoiceRoom — коды восстановления'),
    t('Аккаунт: {p0}', { p0: login }),
    t('Созданы: {p0}', { p0: createdAt.toLocaleString(localeTag(getLocale())) }),
    '',
    t('Каждый код срабатывает один раз. Храните их отдельно от пароля.'),
    '',
    ...codes,
    ''
  ].join('\n');
}

export function shouldShowRecoveryCodesReminder(security: AccountSecurity, now = Date.now()): boolean {
  return isRecoveryCodesReminderDue(security.recoveryCodes, security.recoveryCodesReminder, now);
}
