import { RECOVERY_CODE_COUNT, isRecoveryCodesReminderDue } from '@voice-room/shared/account-security';
import type { AccountSecurity, AccountSession, RecoveryCodesStatus } from '$lib/api/auth';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function sessionDeviceLabel(session: Pick<AccountSession, 'client' | 'os'>): string {
  const client = session.client || 'Неизвестный браузер';
  return session.os ? `${client} · ${session.os}` : client;
}

// The server refreshes a session's last visit at most once an hour, so anything
// more precise than "within the hour" would be made up.
export function formatLastSeen(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < HOUR_MS) return 'Активен в течение часа';
  if (elapsed < DAY_MS) return `Заходил ${Math.floor(elapsed / HOUR_MS)} ч назад`;
  if (elapsed < 7 * DAY_MS) return `Заходил ${Math.floor(elapsed / DAY_MS)} дн. назад`;
  return `Заходил ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(timestamp)}`;
}

export function recoveryCodesSummary(status: RecoveryCodesStatus): string {
  if (status.remaining === 0) {
    return status.generatedAt
      ? 'Все коды использованы. Создайте новые, иначе забытый пароль не восстановить.'
      : 'Кодов пока нет. Без них забытый пароль не восстановить.';
  }
  const created = status.generatedAt
    ? ` · созданы ${new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(status.generatedAt)}`
    : '';
  return `Осталось ${status.remaining} из ${RECOVERY_CODE_COUNT}${created}`;
}

export function recoveryCodesFileText(codes: string[], login: string, createdAt = new Date()): string {
  return [
    'Voice Room — коды восстановления',
    `Аккаунт: ${login}`,
    `Созданы: ${createdAt.toLocaleString('ru-RU')}`,
    '',
    'Каждый код срабатывает один раз. Храните их отдельно от пароля.',
    '',
    ...codes,
    ''
  ].join('\n');
}

export function shouldShowRecoveryCodesReminder(security: AccountSecurity, now = Date.now()): boolean {
  return isRecoveryCodesReminderDue(security.recoveryCodes, security.recoveryCodesReminder, now);
}
