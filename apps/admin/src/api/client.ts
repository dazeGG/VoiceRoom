// HTTP for the admin app. Every answer is checked against its contract schema
// before the app sees it, so a field the API stopped sending fails here, with
// the schema's own path, instead of somewhere in a page. A lost admin session
// sends the browser back through the handoff (/api/staff/check), which either
// signs it in again or ends on the 404 for someone who is not staff.

import type { Static, TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { ERROR_TEXTS, type ErrorCode } from './error-texts.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function failureOf(body: unknown): { code: string; error: string } {
  if (typeof body !== 'object' || body === null) return { code: '', error: '' };
  const code = 'code' in body && typeof body.code === 'string' ? body.code : '';
  const error = 'error' in body && typeof body.error === 'string' ? body.error : '';
  return { code, error };
}

function isErrorCode(code: string): code is ErrorCode {
  return code in ERROR_TEXTS;
}

function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Leaves for the handoff; the page comes back signed in, or as the 404. */
export function signInAgain(): void {
  window.location.assign('/api/staff/check');
}

async function send<Schema extends TSchema>(
  method: string,
  path: string,
  schema: Schema,
  fallback: string,
  body?: unknown
): Promise<Static<Schema>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch {
    throw new ApiError(fallback, 0, 'network_error');
  }
  const parsed = parseJson(await response.text());
  if (!response.ok) {
    const { code } = failureOf(parsed);
    if (response.status === 401 && code === 'staff_session_required') signInAgain();
    throw new ApiError(isErrorCode(code) ? ERROR_TEXTS[code] : fallback, response.status, code);
  }
  if (!Value.Check(schema, parsed)) {
    const first = Value.Errors(schema, parsed).at(0);
    console.error('admin: answer does not match its contract', path, first?.instancePath, first?.message);
    throw new ApiError(fallback, response.status, 'contract_violation');
  }
  return parsed;
}

export const api = {
  get: <Schema extends TSchema>(path: string, schema: Schema, fallback: string) => send('GET', path, schema, fallback),
  post: <Schema extends TSchema>(path: string, schema: Schema, body: unknown, fallback: string) =>
    send('POST', path, schema, fallback, body),
  put: <Schema extends TSchema>(path: string, schema: Schema, body: unknown, fallback: string) =>
    send('PUT', path, schema, fallback, body)
};

/** A query string from the set values, or nothing. */
export function search(query: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : '';
}
