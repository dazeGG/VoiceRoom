import type { LoginAlert } from '$lib/api/auth';
import { timeAgo } from '$lib/shared/utils/date-format';
import { sessionDeviceLabel } from './account-security';

export type SecureAccountTarget = 'password' | 'recovery-codes';

export function loginAlertHeadline(alert: Pick<LoginAlert, 'kind'>): string {
  return alert.kind === 'recovery'
    ? 'В ваш аккаунт вошли по коду восстановления'
    : 'В ваш аккаунт вошли с нового устройства';
}

export function loginAlertDevice(alert: Pick<LoginAlert, 'client' | 'os'>): string {
  return sessionDeviceLabel(alert);
}

export function loginAlertWhen(alert: Pick<LoginAlert, 'createdAt' | 'location'>, now = Date.now()): string {
  const when =
    now - alert.createdAt < 60 * 60_000
      ? timeAgo(alert.createdAt, now)
      : new Intl.DateTimeFormat('ru-RU', {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit'
        }).format(alert.createdAt);
  return alert.location ? `${alert.location} · ${when}` : when;
}

// Oldest first, without duplicates: a live event and a reload can bring the same one.
export function queueLoginAlert(queue: readonly LoginAlert[], alert: LoginAlert): LoginAlert[] {
  if (queue.some((entry) => entry.id === alert.id)) return [...queue];
  return [...queue, alert].sort((left, right) => left.createdAt - right.createdAt);
}
