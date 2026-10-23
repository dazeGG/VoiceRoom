// What the admin app says for the refusals its endpoints give. A code it does
// not know falls back to the text of the call that failed.

import type { ErrorCode } from '@voice-room/shared/contracts/errors';

export const ERROR_TEXTS = {
  authentication_required: 'Войдите в аккаунт VoiceRoom',
  staff_session_required: 'Сеанс админки истёк, входим заново',
  platform_admin_required: 'Этот раздел недоступен вашей роли',
  forbidden: 'Это действие недоступно вашей роли',
  cross_origin_rejected: 'Запрос отклонён: откройте админку по её адресу',
  invalid_request: 'Проверьте введённые данные',
  rate_limited: 'Слишком много запросов, попробуйте чуть позже',
  account_not_found: 'Аккаунт не найден',
  account_deletion_unavailable: 'Удаление аккаунтов сейчас недоступно',
  cannot_moderate_admin: 'Аккаунт сотрудника нельзя заблокировать или удалить',
  confirmation_mismatch: 'Логин не совпадает с этим аккаунтом',
  deletion_not_by_admin: 'Удаление попросил сам пользователь, отменить его может только он',
  report_not_found: 'Жалоба уже рассмотрена',
  staff_role_fixed: 'Этот суперадминистратор задан в настройках сервера',
  staff_role_self: 'Свою роль изменить нельзя'
} as const satisfies Partial<Record<ErrorCode, string>>;

/** A refusal code this app has its own text for. */
export type KnownErrorCode = keyof typeof ERROR_TEXTS;
