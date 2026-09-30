// The one way the web talks HTTP to the API. Every route answers with the
// envelope in @voice-room/shared/contracts/http: a success body typed by the
// route's contract, or a Failure that becomes an ApiError. Requests are
// same-origin, so the HttpOnly session cookie always rides along.

import { createLogger } from '../shared/log.ts';
import { errorText } from './error-texts.ts';

const log = createLogger('api');

const UNAVAILABLE = 'Сервер недоступен';

/**
 * What the user reads for a failure body: the text this build keeps for its
 * code, else the server's own wording, else `fallback`.
 */
export function failureMessage(body: Record<string, unknown> | null, fallback: string): string {
  const known = typeof body?.code === 'string' ? errorText(body.code) : null;
  return known ?? (typeof body?.error === 'string' && body.error ? body.error : fallback);
}

/** A failure the API answered with, or a request that never got an answer. */
export class ApiError extends Error {
  /** HTTP status; 0 when the request failed before a response arrived. */
  readonly status: number;
  /** Machine-readable reason from the Failure body, '' when the server gave none. */
  readonly code: string;
  /** The whole failure body, for the few answers that carry more fields. */
  readonly details: Record<string, unknown>;

  constructor(message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = typeof details.code === 'string' ? details.code : '';
    this.details = details;
  }

  get retryAfterSeconds(): number | null {
    const value = this.details.retryAfterSeconds;
    return typeof value === 'number' ? value : null;
  }
}

export type RequestOptions = {
  /** JSON-encoded unless it is FormData. */
  body?: unknown;
  signal?: AbortSignal;
  /** Extra request headers, such as an Idempotency-Key. */
  headers?: Record<string, string>;
  /** The message when the server gives none. */
  fallback?: string;
};

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function readBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// The API echoes the id it logged the request under. Recording it on every
// failure is what turns "it did not work at 14:20" into a single lookup.
function logFailure(url: string, response: Response): void {
  log.warn('api request failed', {
    url,
    status: response.status,
    requestId: response.headers.get('x-request-id') ?? ''
  });
}

/**
 * Sends one request and returns the success body. `Success` is the route's
 * contract type from @voice-room/shared/contracts; this is the only place a
 * response body is trusted to match it.
 */
export async function request<Success>(method: Method, url: string, options: RequestOptions = {}): Promise<Success> {
  const { body, signal, fallback = UNAVAILABLE } = options;
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  const init: RequestInit = { method, headers, signal, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const payload = await readBody(response);
  if (!response.ok) {
    logFailure(url, response);
    throw new ApiError(failureMessage(payload, fallback), response.status, payload ?? {});
  }
  if (!payload) throw new ApiError(fallback, response.status);
  return payload as Success;
}

export const api = {
  get: <Success>(url: string, options?: Omit<RequestOptions, 'body'>) => request<Success>('GET', url, options),
  post: <Success>(url: string, body: unknown = {}, options?: RequestOptions) =>
    request<Success>('POST', url, { ...options, body }),
  put: <Success>(url: string, body: unknown = {}, options?: RequestOptions) =>
    request<Success>('PUT', url, { ...options, body }),
  patch: <Success>(url: string, body: unknown = {}, options?: RequestOptions) =>
    request<Success>('PATCH', url, { ...options, body }),
  delete: <Success>(url: string, body?: unknown, options?: RequestOptions) =>
    request<Success>('DELETE', url, { ...options, body })
};

/** Resolves to null when the API answers 404, for "may not exist" reads. */
export async function orNull<Value>(pending: Promise<Value>): Promise<Value | null> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
