// What every route gets for free: the security headers, `no-store`, the
// `{ ok: false, error, code }` failure shape, and one request metric and log line.
// A route that hijacks its reply skips Fastify's onSend/onResponse hooks and
// with them all of this, so no route does.

import type { FastifyBaseLogger, FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isErrorCode, type ErrorCode } from '@voice-room/shared/contracts/errors';
import type { Failure as FailureBody } from '@voice-room/shared/contracts/http';

export interface RequestSample {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}

export interface HttpKitOptions {
  securityHeaders: () => Record<string, string>;
  recordRequest: (sample: RequestSample) => void;
  logRequest: (request: FastifyRequest, statusCode: number, durationMs: number) => void;
  logHandlerFailure: (request: FastifyRequest, route: string, error: unknown) => void;
}

export function routeLabel(request: FastifyRequest): string {
  return request.routeOptions?.url || request.url || 'unknown';
}

/** The failure body every route answers with. */
export type Failure = FailureBody & { code: ErrorCode };

/** A failure: the server's own wording and the catalogued code the web picks its text by. */
export function failure(error: string, { code }: { code: ErrorCode }): Failure {
  return { ok: false, error, code };
}

/** The code an error carries when it is a catalogued one, `fallback` otherwise. */
export function errorCode(error: unknown, fallback: ErrorCode): ErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  return isErrorCode(code) ? code : fallback;
}

/**
 * Answers a domain service's error: it carries its HTTP status and code, and
 * anything else is a server failure whose message stays private and is logged.
 */
export function sendServiceError(
  reply: FastifyReply,
  error: unknown,
  { fallback, log, what }: { fallback: ErrorCode; log: FastifyBaseLogger; what: string }
) {
  const known = error as { statusCode?: unknown; message?: string } | null;
  const status = typeof known?.statusCode === 'number' && Number.isInteger(known.statusCode) ? known.statusCode : 500;
  if (status >= 500) {
    log.error({ err: error }, `${what} failed`);
    return reply.code(status).send(failure('Internal server error', { code: fallback }));
  }
  const code = errorCode(error, fallback);
  return reply.code(status).send(failure(known?.message || code, { code }));
}

function fallbackCode(status: number): ErrorCode {
  if (status >= 500) return 'internal_error';
  if (status === 401) return 'authentication_required';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  return 'invalid_request';
}

/**
 * preValidation hook for routes whose legacy handler read a missing or `null`
 * JSON body as `{}`. Without it the body schema answers 400 before the handler
 * gets to give its own (401, 403, ...) answer.
 */
export async function optionalJsonBody(request: FastifyRequest): Promise<void> {
  if (request.body === undefined || request.body === null) request.body = {};
}

/**
 * A field sent with the wrong type is named ("muted must be a boolean");
 * anything else a schema refuses is just an invalid request.
 */
function validationMessage(errors: NonNullable<FastifyError['validation']>): string {
  const [first] = errors;
  const field = first?.instancePath.replace(/^\//, '');
  const type = (first?.params as { type?: unknown } | undefined)?.type;
  if (errors.length === 1 && first?.keyword === 'type' && field && !field.includes('/') && typeof type === 'string') {
    return `${field} must be a ${type}`;
  }
  return 'Invalid request';
}

/**
 * Validator options for every Fastify instance: bodies keep the types they
 * were sent with ("true" is not a boolean), and the contracts type every
 * querystring and path parameter as a string.
 */
export const AJV_OPTIONS = { customOptions: { coerceTypes: false } } as const;

export function registerHttpKit(app: FastifyInstance, options: HttpKitOptions): void {
  app.addHook('onSend', async (_request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    for (const [name, value] of Object.entries(options.securityHeaders())) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    return payload;
  });

  app.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const durationMs = reply.elapsedTime;
    options.recordRequest({
      method: request.method,
      route: routeLabel(request),
      statusCode: reply.statusCode,
      durationMs
    });
    options.logRequest(request, reply.statusCode, durationMs);
  });

  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    if (error.validation) {
      return reply.code(400).send(failure(validationMessage(error.validation), { code: 'invalid_request' }));
    }
    const status = typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) options.logHandlerFailure(request, routeLabel(request), error);
    const message = status >= 500 ? 'Internal server error' : error.message;
    return reply.code(status).send(failure(message, { code: errorCode(error, fallbackCode(status)) }));
  });
}
