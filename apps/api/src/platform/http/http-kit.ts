// What every route gets for free: the security headers, `no-store`, the
// `{ ok: false, error }` failure shape, and one request metric and log line.
// A route that hijacks its reply skips Fastify's onSend/onResponse hooks and
// with them all of this, so no route does.

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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

/** The failure body every route answers with, legacy or native. */
export interface Failure {
  ok: false;
  error: string;
  code?: string;
}

export function failure(error: string, extra: { code?: string } = {}): Failure {
  return { ok: false, error, ...extra };
}

/**
 * preValidation hook for routes whose legacy handler read a missing or `null`
 * JSON body as `{}`. Without it the body schema answers 400 before the handler
 * gets to give its own (401, 403, ...) answer.
 */
export async function optionalJsonBody(request: FastifyRequest): Promise<void> {
  if (request.body === undefined || request.body === null) request.body = {};
}

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
      return reply.code(400).send(failure('Invalid request', { code: 'invalid_request' }));
    }
    const status = typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
    if (status >= 500) options.logHandlerFailure(request, routeLabel(request), error);
    return reply.code(status).send(failure(status >= 500 ? 'Internal server error' : error.message));
  });
}
