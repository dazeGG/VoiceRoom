import { Value } from 'typebox/value';
import type { Static, TSchema } from 'typebox';
import { isErrorCode, type ErrorCode } from '@voiceroom/shared/contracts/errors';
import { isRecord } from '@voiceroom/shared/guards';

export function widgetErrorMessage(code: string): string {
  switch (code) {
    case 'room_not_found':
    case 'room_banned':
    case 'room_full':
    case 'server_full':
      return 'Комната недоступна или заполнена';
    case 'room_create_rate_limited':
    case 'temporary_room_quota':
      return 'Превышен лимит создания комнат';
    default:
      return 'Сервер недоступен или ответ несовместим';
  }
}

export class WidgetApiError extends Error {
  constructor(
    readonly code: ErrorCode | '',
    readonly status: number
  ) {
    super(widgetErrorMessage(code));
  }
}

export async function widgetRequest<S extends TSchema>(
  path: string,
  schema: S,
  body?: unknown,
  signal?: AbortSignal
): Promise<Static<S>> {
  const response = await fetch(path, {
    credentials: 'omit',
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {})
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok || !Value.Check(schema, value)) {
    throw new WidgetApiError(isRecord(value) && isErrorCode(value.code) ? value.code : '', response.status);
  }
  return value;
}
