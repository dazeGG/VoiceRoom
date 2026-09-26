// The Fastify instance every API app starts from: request ids, the origin
// guard, the shared response kit (headers, failure shape, metrics, request
// log), the cookie/multipart/WebSocket plugins and the JSON 404.

import type http from 'node:http';
import fastify, { LogController, type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import { LOG_EVENTS } from '../../lib/log-events.ts';
import { createFastifyLoggerOptions, newRequestId, normalizeRequestId } from '../../lib/logger.ts';
import { recordHttpRequest } from '../../lib/metrics.ts';
import { AJV_OPTIONS, failure, registerHttpKit, type HttpKitOptions } from './http-kit.ts';
import { isCrossOriginCookieWrite, isCrossOriginWebSocket } from './origin-guard.mts';

export interface FastifyAppOptions {
  bodyLimit: number;
  trustProxy: boolean;
  maxUploadBytes: number;
  wsMaxPayloadBytes: number;
  securityHeaders: HttpKitOptions['securityHeaders'];
  logRequest: HttpKitOptions['logRequest'];
  /** Whether the request carries a session cookie (the origin guard then refuses cross-origin writes). */
  hasSessionCookie(req: http.IncomingMessage): boolean;
}

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
    logger: createFastifyLoggerOptions(),
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
    if (isCrossOriginWebSocket(request.raw)) {
      // The refused handshake socket is not an HTTP connection the server
      // tracks, so it has to be closed explicitly once the 403 is written.
      reply
        .code(403)
        .header('Connection', 'close')
        .send(failure('Cross-origin request rejected', { code: 'cross_origin_rejected' }));
      reply.raw.once('finish', () => request.raw.socket?.destroySoon?.());
      return;
    }
    if (isCrossOriginCookieWrite(request.raw, options.hasSessionCookie(request.raw))) {
      reply.code(403).send(failure('Cross-origin request rejected', { code: 'cross_origin_rejected' }));
      return;
    }
    done();
  });

  registerHttpKit(app, {
    securityHeaders: options.securityHeaders,
    recordRequest: recordHttpRequest,
    logRequest: options.logRequest,
    logHandlerFailure: (request, route, error) => {
      request.log?.error?.({ evt: LOG_EVENTS.HTTP_HANDLER_FAILED, route, err: error }, 'route handler failed');
    }
  });

  app.register(fastifyCookie, { hook: 'onRequest' });
  app.register(fastifyMultipart, { limits: { fileSize: options.maxUploadBytes, files: 1, parts: 2 } });
  app.register(fastifyWebsocket, { options: { maxPayload: options.wsMaxPayloadBytes } });

  app.setNotFoundHandler((request, reply) => {
    reply
      .headers(options.securityHeaders())
      .code(404)
      .send(failure('Not found', { code: 'not_found' }));
  });

  return app;
}
