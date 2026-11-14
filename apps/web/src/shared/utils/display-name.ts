/** What a person is called on screen: their display name, or their login when none is set. */
export function displayNameOf(user: { displayName?: string | null | undefined; login: string }): string {
  return isDeletedAccountLogin(user.login) ? t('Удалённый аккаунт') : user.displayName?.trim() || user.login;
}
import { isDeletedAccountLogin } from '@voice-room/shared/account-security';
import { t } from '@/shared/i18n';
