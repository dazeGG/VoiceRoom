// What every Fastify-native route gets for free. The legacy handlers write
// their own responses through sendJson() and time themselves in
// runLegacyHandler(); a route that replies through Fastify must end up with
// the same security headers, the same `{ ok: false, error }` failures and the
// same request metric and log line, or moving a route out of server.js would
// silently change what clients and operators see.
//
// Hijacked (legacy) replies skip Fastify's onSend/onResponse hooks, so nothing
// here double-counts them.

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
    options.recordRequest({ method: request.method, route: routeLabel(request), statusCode: reply.statusCode, durationMs });
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
