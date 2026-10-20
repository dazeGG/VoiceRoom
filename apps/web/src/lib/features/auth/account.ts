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

const blockedUntilFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' });

/** What a blocked account reads at sign-in: until when, and the administrator's reason. */
export function blockedMessage(failure: Pick<AccountFailure, 'blockedUntil' | 'blockReason'>): string {
  const until = failure.blockedUntil ?? null;
  const reason = failure.blockReason?.trim() ?? '';
  const term =
    until === null ? 'Аккаунт заблокирован навсегда' : `Аккаунт заблокирован до ${blockedUntilFormat.format(until)}`;
  return reason ? `${term}. Причина: ${reason}` : `${term}.`;
}
