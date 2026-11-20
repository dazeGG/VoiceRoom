// The Fastify instance every API app starts from: request ids, the origin
// guard, the shared response kit (headers, failure shape, metrics, request
// log), the cookie/multipart/WebSocket plugins and the JSON 404.

import type http from 'node:http';
import fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { createFastifyLoggerOptions, newRequestId, normalizeRequestId } from '../../lib/logger.ts';
import { recordHttpRequest } from '../../lib/metrics.ts';
import { AJV_OPTIONS, failure, registerHttpKit, type HttpKitOptions } from './http-kit.ts';
import { isCrossOriginCookieWrite, isCrossOriginWebSocket, requestHasUnsafeMethod } from './origin-guard.mts';
import { CLIENT_POLICY_PATH } from '../client-policy-routes.ts';

export interface FastifyAppOptions {
  bodyLimit: number;
  trustProxy: boolean;
  wsMaxPayloadBytes: number;
  securityHeaders: HttpKitOptions['securityHeaders'];
  logRequest: HttpKitOptions['logRequest'];
  logger?: FastifyBaseLogger;
  browserOrigin?: string;
  accountHttp?: {
    maxUploadBytes: number;
    /** Whether the request carries a session cookie (then origin-check writes). */
    hasSessionCookie(req: http.IncomingMessage): boolean;
    /** The Android version if below the minimum, else null. */
    outdatedClientVersion(req: http.IncomingMessage): string | null;
  };
}

// What an outdated Android app may still do besides reading the client policy.
const OUTDATED_APP_ROUTES: ReadonlySet<string> = new Set(['POST /api/auth/logout', 'DELETE /api/push/devices']);

export function createFastifyApp(options: FastifyAppOptions): FastifyInstance {
  const app = fastify({
    bodyLimit: options.bodyLimit,
    // Request lines come from our own logRequest (one record per request,
    // healthz excluded), not from Fastify's built-in pair.
    logController: new LogController({ disableRequestLogging: true }),
    // A request id supplied by the edge is reused so one identifier spans
    // Caddy, the API and the browser report that quotes it; anything malformed
    // is replaced rather than trusted into the log stream.
    genReqId: (request) => normalizeRequestId(request.headers['x-request-id']) || newRequestId(),
    ...(options.logger ? { loggerInstance: options.logger } : { logger: createFastifyLoggerOptions() }),
    trustProxy: options.trustProxy,
    ajv: AJV_OPTIONS
  });

  // The client cannot quote an id it never saw, so every response carries it
  // back — including the error responses a user is most likely to report.
  // It is set on the raw response so it also reaches the WebSocket upgrade
  // refusal and the not-found handler.
  app.addHook('onRequest', (request, reply, done) => {
    reply.raw.setHeader('x-request-id', request.id);
    done();
  });

  // Origin checks run for every route: every route that mutates state does so
  // with the same session cookie.
  app.addHook('onRequest', (request, reply, done) => {
    const upgrade = request.headers.upgrade?.toLowerCase() === 'websocket';
    const wrongOrigin =
      options.browserOrigin && request.headers.origin !== undefined && request.headers.origin !== options.browserOrigin;
    if ((upgrade && wrongOrigin) || isCrossOriginWebSocket(request.raw)) {
      // The refused handshake socket is not an HTTP connection the server
      // tracks, so it has to be closed explicitly once the 403 is written.
      reply
        .code(403)
        .header('Connection', 'close')
        .send(failure('Cross-origin request rejected', { code: 'cross_origin_rejected' }));
      reply.raw.once('finish', () => request.raw.socket?.destroySoon?.());
      return;
    }
    if (
      (wrongOrigin && request.routeOptions.url && requestHasUnsafeMethod(request.raw)) ||
      isCrossOriginCookieWrite(request.raw, options.accountHttp?.hasSessionCookie(request.raw) ?? false)
    ) {
      reply.code(403).send(failure('Cross-origin request rejected', { code: 'cross_origin_rejected' }));
      return;
    }
    done();
  });

  const accountHttp = options.accountHttp;
  if (accountHttp) {
    // React Native reports a refused upgrade as a bare error, so /api/ws
    // closes the opened socket with 4426 instead (app/api-routes.ts).
    app.addHook('onRequest', (request, reply, done) => {
      const path = request.url.split('?')[0] ?? '';
      const upgrade = path === '/api/ws' && String(request.headers.upgrade || '').toLowerCase() === 'websocket';
      const exempt = path === CLIENT_POLICY_PATH || OUTDATED_APP_ROUTES.has(`${request.method} ${path}`) || upgrade;
      const version = path.startsWith('/api/') && !exempt ? accountHttp.outdatedClientVersion(request.raw) : null;
      if (version === null) {
        done();
        return;
      }
      request.log.info({ evt: LOG_EVENTS.HTTP_CLIENT_OUTDATED, transport: 'http', version }, 'outdated app refused');
      reply.code(426).send(failure('Client outdated', { code: 'client_outdated' }));
    });
    app.register(fastifyCookie, { hook: 'onRequest' });
    app.register(fastifyMultipart, { limits: { fileSize: accountHttp.maxUploadBytes, files: 1, parts: 2 } });
  }

  registerHttpKit(app, {
    securityHeaders: options.securityHeaders,
    recordRequest: accountHttp ? recordHttpRequest : () => {},
    logRequest: options.logRequest,
    logHandlerFailure: (request, route, error) => {
      request.log?.error?.(
        { evt: LOG_EVENTS.HTTP_HANDLER_FAILED, route, err: route.startsWith('/api/widget/') ? undefined : error },
        'route handler failed'
      );
    }
  });

  app.register(fastifyWebsocket, { options: { maxPayload: options.wsMaxPayloadBytes } });

  app.setNotFoundHandler((request, reply) => {
    reply
      .headers(options.securityHeaders())
      .code(404)
      .send(failure('Not found', { code: 'not_found' }));
  });

  return app;
}
