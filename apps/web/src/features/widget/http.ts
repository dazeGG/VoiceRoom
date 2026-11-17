import { Value } from 'typebox/value';
import type { Static, TSchema } from 'typebox';
export async function widgetRequest<S extends TSchema>(
  path: string,
  schema: S,
  body?: unknown,
  method?: 'DELETE'
): Promise<Static<S>> {
  const response = await fetch(path, {
    credentials: 'omit',
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const value: unknown = await response.json();
  if (!response.ok || !Value.Check(schema, value)) {
    const error =
      typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
        ? value.error
        : 'Сервер недоступен или ответ несовместим';
    throw new Error(error);
  }
  return value;
}
