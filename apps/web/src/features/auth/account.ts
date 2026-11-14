import { getLocale, t } from '@/shared/i18n';
import { localeTag } from '@voice-room/shared/localization';
import type { AccountFailure } from '@voice-room/shared/contracts/account';

export const PASSWORD_MIN_LENGTH = 8;
export const LOGIN_HINT = '3–32 символа: латиница, цифры, точка, дефис, подчёркивание';

// Client-side mirrors of the API validators. The server stays authoritative —
// these only keep the forms from posting obviously invalid input.
export function normalizeLogin(value: string): string {
  const login = String(value || '')
    .trim()
    .toLowerCase();
  return /^[a-z0-9._-]{3,32}$/.test(login) ? login : '';
}

export function isValidPassword(value: string): boolean {
  return typeof value === 'string' && value.length >= PASSWORD_MIN_LENGTH && value.length <= 200;
}

/** What a blocked account reads at sign-in: until when, and the administrator's reason. */
export function blockedMessage(failure: Pick<AccountFailure, 'blockedUntil' | 'blockReason'>): string {
  const until = failure.blockedUntil ?? null;
  const reason = failure.blockReason?.trim() ?? '';
  const term =
    until === null
      ? t('Аккаунт заблокирован навсегда')
      : t('Аккаунт заблокирован до {p0}', {
          p0: new Intl.DateTimeFormat(localeTag(getLocale()), { dateStyle: 'long', timeStyle: 'short' }).format(until)
        });
  return reason ? t('{p0}. Причина: {p1}', { p0: term, p1: reason }) : `${term}.`;
}
