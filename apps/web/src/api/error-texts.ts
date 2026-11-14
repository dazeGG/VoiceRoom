import { t } from '../shared/i18n/runtime.ts';
// What the user reads for each failure code the API sends. The API's own
// `error` text is only a fallback for a code this build does not know yet (a
// newer server), so every refusal reads the same wherever the web shows it.

import { isErrorCode, type ErrorCode } from '@voice-room/shared/contracts/errors';

const TRY_LATER = 'Слишком много попыток, попробуйте позже';
const UNAVAILABLE = 'Сервис временно недоступен, попробуйте позже';
const VOICE_UNAVAILABLE = 'Голосовая связь временно недоступна';
const IMAGE_FAILED = 'Не удалось загрузить изображение';
const REALTIME_REJECTED = 'Сервер не понял запрос, обновите страницу';

export const ERROR_TEXTS: Record<ErrorCode, string> = {
  get push_registration_conflict() {
    return t('Язык уведомлений обновлён в другом окне. Повторяем сохранение.');
  },
  get invalid_request() {
    return t('Некорректный запрос');
  },
  get authentication_required() {
    return t('Требуется вход');
  },
  get forbidden() {
    return t('Недостаточно прав');
  },
  get not_found() {
    return t('Не найдено');
  },
  get rate_limited() {
    return t(TRY_LATER);
  },
  get internal_error() {
    return t('Ошибка сервера, попробуйте позже');
  },
  get cross_origin_rejected() {
    return t('Запрос отклонён: откройте сайт заново');
  },
  get not_supported() {
    return t('Не поддерживается');
  },
  get client_outdated() {
    return t('Версия приложения устарела, обновите его');
  },

  get call_not_found() {
    return t('Звонок не найден');
  },
  get account_not_found() {
    return t('Аккаунт не найден');
  },
  get account_deleted() {
    return t('Аккаунт удалён');
  },
  get account_already_deleted() {
    return t('Аккаунт уже удалён');
  },
  get account_deletion_pending() {
    return t('Аккаунт ожидает удаления');
  },
  get account_deletion_unavailable() {
    return t('Удаление аккаунта сейчас недоступно');
  },
  get invalid_login() {
    return t('Логин: 3–32 символа, латиница, цифры, . _ -');
  },
  get login_taken() {
    return t('Этот логин уже занят');
  },
  get password_too_short() {
    return t('Пароль должен быть не короче 8 символов');
  },
  get passwords_mismatch() {
    return t('Пароли не совпадают');
  },
  get wrong_password() {
    return t('Неверный пароль');
  },
  get wrong_current_password() {
    return t('Неверный текущий пароль');
  },
  get invalid_credentials() {
    return t('Неверный логин или пароль');
  },
  get invalid_recovery() {
    return t('Неверный логин или код восстановления');
  },
  get session_not_found() {
    return t('Сеанс не найден');
  },
  get current_session() {
    return t('Чтобы завершить этот сеанс, выйдите из аккаунта');
  },
  get login_alert_not_found() {
    return t('Вход не найден или на него уже ответили');
  },

  get user_not_found() {
    return t('Пользователь не найден');
  },
  get invalid_user() {
    return t('Неверный пользователь');
  },
  get cannot_befriend_self() {
    return t('Нельзя добавить себя');
  },
  get friend_request_refused() {
    return t('Заявку отправить нельзя');
  },
  get friend_request_not_found() {
    return t('Заявка не найдена');
  },
  get friend_request_rate_limited() {
    return t('Слишком много заявок, попробуйте позже');
  },
  get friend_not_found() {
    return t('Друг не найден');
  },
  get not_friends() {
    return t('Вы не друзья');
  },
  get relationship_blocked() {
    return t('Сообщение недоступно');
  },
  get cannot_block_user() {
    return t('Нельзя заблокировать этого пользователя');
  },
  get block_failed() {
    return t('Не удалось сохранить блокировку');
  },
  get user_not_blocked() {
    return t('Пользователь не заблокирован');
  },

  get room_not_found() {
    return t('Комната не найдена');
  },
  get room_gone() {
    return t('Комната больше не существует');
  },
  get invalid_room() {
    return t('Неверный код комнаты');
  },
  get room_name_required() {
    return t('Дайте комнате название');
  },
  get static_room_requires_login() {
    return t('Требуется вход для создания постоянной комнаты');
  },
  get room_create_rate_limited() {
    return t('Слишком много новых комнат, попробуйте позже');
  },
  get room_not_static() {
    return t('В список можно добавить только постоянную комнату');
  },
  get room_forbidden() {
    return t('Комната недоступна');
  },
  get room_full() {
    return t('Комната заполнена');
  },
  get room_banned() {
    return t('Вы заблокированы в этой комнате');
  },
  get room_owner() {
    return t('Владелец не может покинуть свою комнату');
  },
  get room_owner_cannot_leave() {
    return t('Владелец не может покинуть свою комнату');
  },
  get room_leave_failed() {
    return t('Не удалось покинуть комнату');
  },
  get room_leave_unavailable() {
    return t('Не удалось покинуть комнату, попробуйте позже');
  },
  get static_room_quota() {
    return t('Можно владеть максимум 3 постоянными комнатами');
  },
  get temporary_room_quota() {
    return t('Слишком много временных комнат, используйте одну из них');
  },
  get room_delete_peer_cleanup_failed() {
    return t('Не удалось удалить комнату, попробуйте позже');
  },
  get room_ban_peer_cleanup_failed() {
    return t('Не удалось заблокировать участника, попробуйте позже');
  },
  get room_ban_limit() {
    return t('Достигнут предел блокировок в комнате');
  },
  get owner_required() {
    return t('Это может только владелец комнаты');
  },
  get peer_not_found() {
    return t('Участник не найден');
  },
  get cannot_kick_owner() {
    return t('Нельзя исключить владельца комнаты');
  },
  get cannot_ban_owner() {
    return t('Нельзя заблокировать владельца комнаты');
  },
  get cannot_mute_owner() {
    return t('Нельзя выключить микрофон владельцу комнаты');
  },
  get server_mute_unsupported() {
    return t('Участник не поддерживает модерацию микрофона');
  },
  get server_mute_unavailable() {
    return t(VOICE_UNAVAILABLE);
  },
  get ban_not_found() {
    return t('Блокировка не найдена');
  },
  get invalid_ring_target() {
    return t('Этому пользователю нельзя позвонить');
  },
  get invite_cooldown() {
    return t('Приглашение уже отправлено, подождите немного');
  },
  get state_updates_require_websocket() {
    return t('Соединение с комнатой потеряно, обновите страницу');
  },
  get presence_or_login_required() {
    return t('Войдите в комнату или в аккаунт');
  },
  get membership_required() {
    return t('Сначала вступите в комнату');
  },
  get membership_unavailable() {
    return t(UNAVAILABLE);
  },
  get membership_persist_failed() {
    return t(UNAVAILABLE);
  },
  get credential_revoke_unavailable() {
    return t(UNAVAILABLE);
  },
  get pow_required() {
    return t('Не удалось создать комнату');
  },
  get pow_invalid() {
    return t('Не удалось создать комнату');
  },
  get pow_expired() {
    return t('Проверка создания комнаты истекла');
  },
  get pow_reused() {
    return t('Не удалось создать комнату');
  },

  get invalid_session() {
    return t('Сессия участника недействительна');
  },
  get not_in_room() {
    return t('Сначала нужно войти в комнату');
  },
  get livekit_unconfigured() {
    return t(VOICE_UNAVAILABLE);
  },
  get livekit_gate_unavailable() {
    return t(VOICE_UNAVAILABLE);
  },
  get livekit_gate_principal_unavailable() {
    return t(VOICE_UNAVAILABLE);
  },
  get livekit_gate_credential_unavailable() {
    return t(VOICE_UNAVAILABLE);
  },
  get livekit_gate_revoke_unavailable() {
    return t(VOICE_UNAVAILABLE);
  },
  get livekit_gate_principal_missing() {
    return t(VOICE_UNAVAILABLE);
  },

  get message_not_found() {
    return t('Сообщение не найдено');
  },
  get message_not_visible() {
    return t('Сообщение недоступно');
  },
  get empty_message() {
    return t('Пустое сообщение');
  },
  get invalid_message() {
    return t('Сообщение не отправлено: неверный формат');
  },
  get invalid_message_content() {
    return t('Сообщение не отправлено: неверный формат');
  },
  get invalid_mentions() {
    return t('Не удалось отметить участников');
  },
  get invalid_mention_target() {
    return t('Этого участника нельзя отметить');
  },
  get self_mention() {
    return t('Нельзя отметить себя');
  },
  get too_many_mentions() {
    return t('Слишком много упоминаний в одном сообщении');
  },
  get mention_not_eligible() {
    return t('Этого участника нельзя упомянуть');
  },
  get creator_not_eligible() {
    return t('Вы не можете упоминать в этой комнате');
  },
  get invalid_attachments() {
    return t('Вложения недоступны, прикрепите их заново');
  },
  get reply_unavailable() {
    return t('Сообщение, на которое вы отвечаете, недоступно');
  },
  get idempotency_conflict() {
    return t('Это сообщение уже отправлялось с другим текстом, попробуйте ещё раз');
  },
  get idempotency_quota_exceeded() {
    return t('Слишком много сообщений, попробуйте позже');
  },
  get message_rate_limited() {
    return t('Слишком много сообщений, попробуйте позже');
  },
  get message_edit_forbidden() {
    return t('Можно редактировать только свои сообщения');
  },
  get message_delete_forbidden() {
    return t('Можно удалять только свои сообщения');
  },
  get thread_not_found() {
    return t('Диалог не найден');
  },
  get thread_forbidden() {
    return t('Диалог недоступен');
  },
  get invite_not_found() {
    return t('Приглашение не найдено');
  },
  get invite_not_editable() {
    return t('Приглашение нельзя редактировать');
  },
  get invite_already_answered() {
    return t('Приглашение уже обработано');
  },
  get not_invited() {
    return t('Отвечать может только приглашённый');
  },
  get invalid_action() {
    return t('Неверное действие');
  },
  get invalid_cursor() {
    return t('Не удалось загрузить историю, обновите страницу');
  },
  get invalid_read_cursor() {
    return t('Не удалось отметить прочитанное');
  },
  get history_error() {
    return t('Не удалось загрузить историю');
  },
  get invalid_conversation() {
    return t('Диалог недоступен');
  },
  get invalid_reaction() {
    return t('Эту реакцию поставить нельзя');
  },
  get invalid_reactor_query() {
    return t('Некорректный запрос');
  },
  get reaction_error() {
    return t('Не удалось поставить реакцию');
  },
  get account_required() {
    return t('Нужен аккаунт');
  },
  get pin_limit_reached() {
    return t('Достигнут предел закреплённых сообщений');
  },
  get pin_error() {
    return t('Не удалось закрепить сообщение');
  },

  get invalid_notification_target() {
    return t('Неверная цель уведомлений');
  },
  get temporary_room() {
    return t('Отключить уведомления можно только в постоянной комнате');
  },
  get not_saved_room() {
    return t('Комната не добавлена в список');
  },
  get invalid_level() {
    return t('Неверный уровень уведомлений');
  },
  get push_disabled() {
    return t('Push-уведомления отключены на сервере');
  },
  get invalid_push_subscription() {
    return t('Не удалось включить push-уведомления');
  },
  get invalid_push_endpoint() {
    return t('Не удалось отключить push-уведомления');
  },
  get push_endpoint_conflict() {
    return t('Это устройство уже подписано другим аккаунтом');
  },
  get push_rate_limited() {
    return t(TRY_LATER);
  },
  get invalid_device_token() {
    return t('Некорректный токен устройства');
  },

  get media_error() {
    return t(IMAGE_FAILED);
  },
  get media_uploads_disabled() {
    return t('Загрузка изображений временно недоступна');
  },
  get media_attachment_id_invalid() {
    return t(IMAGE_FAILED);
  },
  get media_not_found() {
    return t('Изображение не найдено');
  },
  get media_body_required() {
    return t(IMAGE_FAILED);
  },
  get media_byte_quota() {
    return t('Закончилось место для изображений');
  },
  get media_context_invalid() {
    return t(IMAGE_FAILED);
  },
  get media_invalid_image() {
    return t('Файл не похож на изображение');
  },
  get media_pending_limit() {
    return t('Дождитесь загрузки предыдущих изображений');
  },
  get media_pixel_limit() {
    return t('Изображение слишком большое');
  },
  get media_rate_limit() {
    return t('Слишком много загрузок, попробуйте позже');
  },
  get media_request_id_required() {
    return t(IMAGE_FAILED);
  },
  get media_retry_unavailable() {
    return t('Повторить загрузку нельзя, прикрепите изображение заново');
  },
  get media_size_invalid() {
    return t(IMAGE_FAILED);
  },
  get media_size_mismatch() {
    return t(IMAGE_FAILED);
  },
  get media_state_conflict() {
    return t(IMAGE_FAILED);
  },
  get media_too_large() {
    return t('Изображение больше 10 МБ');
  },
  get media_type_mismatch() {
    return t('Поддерживаются JPEG, PNG и WebP');
  },
  get media_type_unsupported() {
    return t('Поддерживаются JPEG, PNG и WebP');
  },
  get avatar_field_required() {
    return t('Выберите изображение');
  },
  get avatar_too_large() {
    return t('Аватар должен быть не больше 5 МБ');
  },
  get upload_rate_limited() {
    return t('Слишком много загрузок, попробуйте позже');
  },
  get image_not_found() {
    return t('Изображение не найдено');
  },
  get report_target_not_found() {
    return t('Сообщение не найдено или уже удалено');
  },
  get report_own_message() {
    return t('Нельзя пожаловаться на своё сообщение');
  },
  get report_not_found() {
    return t('Жалоба уже рассмотрена');
  },
  get platform_admin_required() {
    return t('Раздел доступен только администратору сервиса');
  },
  get account_blocked() {
    return t('Аккаунт заблокирован');
  },
  get reserved_name() {
    return t('Это имя зарезервировано за VoiceRoom');
  },
  get cannot_moderate_admin() {
    return t('Аккаунт администратора нельзя заблокировать или удалить');
  },
  get confirmation_mismatch() {
    return t('Логин не совпадает с этим аккаунтом');
  },
  get deletion_not_by_admin() {
    return t('Удаление попросил сам пользователь, отменить его может только он');
  },
  get staff_session_required() {
    return t('Сеанс админки истёк, обновите страницу');
  },
  get staff_role_fixed() {
    return t('Этот суперадминистратор задан в настройках сервера');
  },
  get staff_role_self() {
    return t('Свою роль изменить нельзя');
  },

  get desktop_release_unavailable() {
    return t('Не удалось получить данные о релизе');
  },

  get invalid_response() {
    return t('Сервер прислал непонятный ответ, обновите страницу');
  },
  get unavailable() {
    return t('Сервер недоступен');
  },

  get invalid_json() {
    return t(REALTIME_REJECTED);
  },
  get invalid_envelope() {
    return t(REALTIME_REJECTED);
  },
  get invalid_payload() {
    return t(REALTIME_REJECTED);
  },
  get unknown_type() {
    return t(REALTIME_REJECTED);
  },
  get invalid_ping() {
    return t(REALTIME_REJECTED);
  },
  get invalid_room_id() {
    return t('Неверный код комнаты');
  },
  get invalid_peer_id() {
    return t('Неверный участник, обновите страницу');
  },
  get invalid_session_token() {
    return t('Сессия участника недействительна');
  },
  get invalid_name() {
    return t('Неверное имя');
  },
  get invalid_media_kind() {
    return t('Неизвестный вид трансляции');
  },
  get invalid_user_id() {
    return t('Неверный пользователь');
  },
  get invalid_typing_activity() {
    return t(REALTIME_REJECTED);
  },

  get invalid_join() {
    return t('Не удалось войти в комнату, обновите страницу');
  },
  get superseded_join() {
    return t('Вход в комнату продолжен в другом окне');
  },
  get reconnect_finalize_failed() {
    return t('Предыдущее подключение ещё закрывается, попробуйте ещё раз');
  },
  get join_failed() {
    return t('Не удалось войти в комнату');
  },
  get not_active_peer() {
    return t('Вы уже не в голосовом канале этой комнаты');
  },
  get update_failed() {
    return t('Не удалось обновить состояние в комнате');
  },
  get server_full() {
    return t('Сервер переполнен, попробуйте позже');
  },
  get credential_boundary_unavailable() {
    return t(VOICE_UNAVAILABLE);
  },
  get principal_unavailable() {
    return t(VOICE_UNAVAILABLE);
  },
  get revoke_failed() {
    return t('Не удалось отключить доступ к комнате, попробуйте ещё раз');
  }
};

/** The text for a failure code, or null when this build does not know the code. */
export function errorText(code: string): string | null {
  return isErrorCode(code) ? ERROR_TEXTS[code] : null;
}
