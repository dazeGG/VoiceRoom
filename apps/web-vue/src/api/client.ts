// The one way the web talks HTTP to the API. Every route answers with the
// envelope in @voice-room/shared/contracts/http: a success body that must match
// the route's contract schema, or a Failure that becomes an ApiError. Requests
// are same-origin, so the HttpOnly session cookie always rides along.

import { isErrorCode, type ErrorCode } from '@voice-room/shared/contracts/errors';
import type { Static, TSchema, TUnknown } from 'typebox';
// Value.Check walks the schema. Never typebox/compile: it builds code with eval, which the CSP forbids.
import { Value } from 'typebox/value';
import { createLogger } from '../shared/log.ts';
import { ERROR_TEXTS, errorText } from './error-texts.ts';
import { reportContractViolation } from './contract-violations.ts';
import { firstMismatch } from '@voice-room/shared/contracts/http';

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
  /** Machine-readable reason from the Failure body; '' when there is none this build knows. */
  readonly code: ErrorCode | '';
  /** The whole failure body; read its extra fields through their contract with failureBody(). */
  readonly details: Record<string, unknown>;

  constructor(message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = isErrorCode(details.code) ? details.code : '';
    this.details = details;
  }

  get retryAfterSeconds(): number | null {
    const value = this.details.retryAfterSeconds;
    return typeof value === 'number' ? value : null;
  }
}

/**
 * A failure body read through its contract, such as AccountFailure for the
 * extra fields of a refused sign-in; null when the body does not match it.
 */
export function failureBody<Schema extends TSchema>(error: ApiError, schema: Schema): Static<Schema> | null {
  return Value.Check(schema, error.details) ? error.details : null;
}

export type RequestOptions<BodySchema extends TSchema = TSchema> = {
  /** JSON-encoded unless it is FormData. */
  body?: unknown;
  /** The route's body contract from @voice-room/shared/contracts; on the api.* writes it types `body`. */
  bodySchema?: BodySchema | undefined;
  signal?: AbortSignal | undefined;
  /** Extra request headers, such as an Idempotency-Key. */
  headers?: Record<string, string> | undefined;
  /** The message when the server gives none. */
  fallback?: string | undefined;
};

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A parsed JSON body that is an object, the only kind an answer or a failure is. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return isJsonObject(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * The success body once it matches `schema`, the route's answer from
 * @voice-room/shared/contracts; otherwise an ApiError with the code
 * invalid_response, so a server change shows as a failure here instead of
 * breaking the UI somewhere later.
 */
export function checkedAnswer<Schema extends TSchema>(
  schema: Schema,
  payload: unknown,
  status: number,
  url: string
): Static<Schema> {
  if (Value.Check(schema, payload)) return payload;
  reportContractViolation('http', { url, status, reason: firstMismatch(schema, payload) });
  throw new ApiError(ERROR_TEXTS.invalid_response, status, { code: 'invalid_response' });
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

/** Sends one request and returns the success body once it matches `schema` (see checkedAnswer). */
export async function request<Schema extends TSchema>(
  method: Method,
  url: string,
  schema: Schema,
  options: RequestOptions = {}
): Promise<Static<Schema>> {
  const { body, bodySchema, signal, fallback = UNAVAILABLE } = options;
  // The types already hold the body to its contract; this catches a value that
  // slipped past them. The server still decides, so the request goes out.
  if (bodySchema && !(body instanceof FormData) && !Value.Check(bodySchema, body)) {
    log.warn('request body outside the contract', { url, reason: firstMismatch(bodySchema, body) });
  }
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  const init: RequestInit = { method, headers, signal: signal ?? null, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // An abort is the caller's own doing and stays as it is; anything else
    // (offline, DNS, a refused connection) never reached the server.
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw new ApiError(ERROR_TEXTS.unavailable, 0, { code: 'unavailable' });
  }
  const payload = await readBody(response);
  if (!response.ok) {
    logFailure(url, response);
    throw new ApiError(failureMessage(payload, fallback), response.status, payload ?? {});
  }
  if (!payload) throw new ApiError(fallback, response.status);
  return checkedAnswer(schema, payload, response.status, url);
}

type PlainOptions = Omit<RequestOptions, 'body' | 'bodySchema'>;

// What a write takes after the schema: nothing, FormData, or a JSON body whose
// type comes from `options.bodySchema`, the route's body contract:
// api.post(url, SignedIn, input, { bodySchema: CredentialsBody }).
// A JSON body without its contract does not compile. `emptyBody` is what goes out when there is none.
type WriteArgs<BodySchema extends TSchema> =
  | [body?: FormData | undefined, options?: PlainOptions]
  | [body: NoInfer<Static<BodySchema>>, options: Omit<RequestOptions<BodySchema>, 'body'> & { bodySchema: BodySchema }];

const write =
  (method: Exclude<Method, 'GET'>, emptyBody?: object) =>
  <Schema extends TSchema, BodySchema extends TSchema = TUnknown>(
    url: string,
    schema: Schema,
    ...[body, options]: WriteArgs<BodySchema>
  ) =>
    request(method, url, schema, { ...options, body: body === undefined ? emptyBody : body });

export const api = {
  get: <Schema extends TSchema>(url: string, schema: Schema, options?: Omit<RequestOptions, 'body' | 'bodySchema'>) =>
    request('GET', url, schema, options),
  post: write('POST', {}),
  put: write('PUT', {}),
  patch: write('PATCH', {}),
  delete: write('DELETE')
};

/** Resolves to null when the API answers 404, for "may not exist" reads. */
export async function orNull<Result>(pending: Promise<Result>): Promise<Result | null> {
  try {
    return await pending;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
